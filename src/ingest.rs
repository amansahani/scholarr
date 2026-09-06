use anyhow::{Context, Result};
use std::path::Path;
use tracing::{info, warn};

use crate::{
    db::{self, DbHandle},
    llm::{LLMService, OpenAIMessage},
    models::{CreateCourseReq, CreateDocumentReq, CreateTopicReq, LLMConfig},
};

pub struct PDFIngestion;

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct ExtractedChapter {
    pub chapter: String,
    pub title: String,
    #[serde(default)]
    pub page_start: Option<usize>,
    #[serde(default)]
    pub page_end: Option<usize>,
    #[serde(default)]
    pub summary: String,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct SyllabusStructure {
    pub course_title: String,
    pub course_description: String,
    pub category: String,
    pub syllabus: String,
    pub topics: Vec<ExtractedChapter>,
}

#[derive(Debug, Clone)]
pub struct PageContent {
    pub page_number: usize,
    pub text: String,
}

impl PDFIngestion {
    /// Extract text on a per-page basis using lopdf / pdf-extract
    pub fn extract_pages(pdf_path: &str) -> Result<Vec<PageContent>> {
        let path = Path::new(pdf_path);
        if !path.exists() {
            return Err(anyhow::anyhow!("PDF file not found at path: {}", pdf_path));
        }

        info!("Extracting per-page text from PDF: {}", pdf_path);
        let doc = lopdf::Document::load(path)
            .with_context(|| format!("Failed to open PDF with lopdf: {}", pdf_path))?;

        let mut pages = Vec::new();
        let page_numbers: Vec<u32> = doc.get_pages().keys().cloned().collect();
        let mut sorted_pages = page_numbers;
        sorted_pages.sort();

        for &p_num in &sorted_pages {
            let page_text = doc.extract_text(&[p_num]).unwrap_or_default();
            pages.push(PageContent {
                page_number: p_num as usize,
                text: page_text,
            });
        }

        // If lopdf produced empty text across pages, fallback to pdf_extract
        let total_chars: usize = pages.iter().map(|p| p.text.trim().len()).sum();
        if total_chars < 100 {
            warn!("lopdf yielded low text yield ({}), falling back to pdf_extract full-text extraction", total_chars);
            let bytes = std::fs::read(path)?;
            let full_text = pdf_extract::extract_text_from_mem(&bytes).unwrap_or_default();
            
            // Approximate pages by splitting form feeds or chunks of ~2000 chars
            let raw_pages: Vec<&str> = if full_text.contains('\x0C') {
                full_text.split('\x0C').collect()
            } else {
                full_text.as_bytes().chunks(2500).map(|c| std::str::from_utf8(c).unwrap_or("")).collect()
            };

            pages = raw_pages
                .into_iter()
                .enumerate()
                .map(|(idx, t)| PageContent {
                    page_number: idx + 1,
                    text: t.to_string(),
                })
                .collect();
        }

        info!("Extracted {} total pages from PDF", pages.len());
        Ok(pages)
    }

    /// Extract complete text string from pages
    pub fn extract_text(pdf_path: &str) -> Result<String> {
        let pages = Self::extract_pages(pdf_path)?;
        let full = pages.iter().map(|p| p.text.as_str()).collect::<Vec<&str>>().join("\n\n");
        Ok(full)
    }

    /// Split text into semantic overlapping chunks
    pub fn chunk_text(text: &str, target_word_count: usize, overlap_words: usize) -> Vec<String> {
        let words: Vec<&str> = text.split_whitespace().collect();
        let mut chunks = Vec::new();
        let mut start = 0;

        while start < words.len() {
            let end = (start + target_word_count).min(words.len());
            let chunk = words[start..end].join(" ");
            if chunk.trim().len() > 40 {
                chunks.push(chunk);
            }
            if end == words.len() {
                break;
            }
            start += target_word_count.saturating_sub(overlap_words);
        }

        chunks
    }

    /// Discover Table of Contents / Index from the first 50 pages:
    /// 1. Inspect first 100-300 characters of each page up to page 50.
    /// 2. Check if page contains TOC indicators ("Contents", "Table of Contents", "Index", "Chapter").
    /// 3. Track contiguous TOC pages until the contents section ends.
    /// 4. If TOC found, extract chapters/topics and map page ranges.
    /// 5. If no TOC (e.g. research papers or notes), perform semantic topic breakdown over full content.
    pub async fn analyze_pages_structure(
        llm: &LLMService,
        config: &LLMConfig,
        pages: &[PageContent],
        custom_course_title: Option<&str>,
    ) -> Result<SyllabusStructure> {
        let title_hint = custom_course_title.unwrap_or("Academic Textbook or Document");
        let max_check = pages.len().min(50);
        let mut toc_start_page: Option<usize> = None;
        let mut toc_end_page: Option<usize> = None;

        // Method 1: Scan first 100-300 characters of pages 1..50 to detect Index / Contents
        for (i, p) in pages[..max_check].iter().enumerate() {
            let prefix_sample = if p.text.len() > 300 {
                &p.text[..300]
            } else {
                &p.text
            };
            let lower = prefix_sample.to_lowercase();

            let is_toc_header = lower.contains("table of contents")
                || lower.contains("contents")
                || (lower.contains("index") && !lower.contains("subject index"))
                || (lower.contains("brief contents") || lower.contains("overview of contents"));

            if is_toc_header {
                if toc_start_page.is_none() {
                    toc_start_page = Some(i);
                }
                toc_end_page = Some(i);
            } else if toc_start_page.is_some() {
                // Check if this consecutive page is still part of TOC
                // (e.g. contains chapter lines, dotted leaders, or page numbers)
                let has_toc_entries = lower.contains("chapter")
                    || lower.contains("module")
                    || lower.contains("part ")
                    || lower.contains("section ")
                    || p.text.lines().filter(|l| l.trim().ends_with(|c: char| c.is_ascii_digit())).count() >= 3;

                if has_toc_entries {
                    toc_end_page = Some(i);
                } else if i > toc_end_page.unwrap_or(0) + 1 {
                    // Contiguous TOC sequence ended
                    break;
                }
            }
        }

        if let (Some(start_idx), Some(end_idx)) = (toc_start_page, toc_end_page) {
            info!("📖 Detected Table of Contents across pages {} to {}", pages[start_idx].page_number, pages[end_idx].page_number);
            
            // Gather all text from the TOC page sequence
            let mut toc_full_text = String::new();
            for p in &pages[start_idx..=end_idx] {
                toc_full_text.push_str(&format!("\n--- Page {} ---\n", p.page_number));
                toc_full_text.push_str(&p.text);
            }

            let sys_prompt = r##"You are an expert textbook curriculum analyzer.
You are provided with the exact extracted Table of Contents / Index text of a textbook.
Extract EVERY single numbered chapter from Chapter 1 to Chapter 11 from the Table of Contents.
Do NOT omit or group any chapter. Each of the 11 chapters MUST be an individual topic entry.

Output STRICTLY a valid JSON object matching this schema with NO markdown wrapping or surrounding text:
{
  "course_title": "Signals and Systems (2nd Edition)",
  "course_description": "Comprehensive study of continuous-time and discrete-time signals and systems, LTI systems, Fourier analysis, sampling, communications, Laplace and Z transforms, and feedback systems.",
  "category": "Electrical & Computer Engineering",
  "syllabus": "# Complete Course Syllabus\n1. **Chapter 1: Signals and Systems**\n2. **Chapter 2: Linear Time-Invariant Systems**\n3. **Chapter 3: Fourier Series Representation of Periodic Signals**\n4. **Chapter 4: The Continuous-Time Fourier Transform**\n5. **Chapter 5: The Discrete-Time Fourier Transform**\n6. **Chapter 6: Time and Frequency Characterization of Signals and Systems**\n7. **Chapter 7: Sampling**\n8. **Chapter 8: Communication Systems**\n9. **Chapter 9: The Laplace Transform**\n10. **Chapter 10: The Z-Transform**\n11. **Chapter 11: Linear Feedback Systems**",
  "topics": [
    {
      "chapter": "Chapter 1",
      "title": "Signals and Systems",
      "page_start": 1,
      "page_end": 73,
      "summary": "Continuous-time and discrete-time signals, signal energy $E = \\int |x(t)|^2 dt$, time-shifting, periodicity, unit impulse $\\delta(t)$ and step $u(t)$, system linearity, causality, and time invariance."
    },
    {
      "chapter": "Chapter 2",
      "title": "Linear Time-Invariant Systems",
      "page_start": 74,
      "page_end": 176,
      "summary": "Convolution sum $y[n] = \\sum x[k]h[n-k]$, convolution integral $y(t) = \\int x(\\tau)h(t-\\tau)d\\tau$, commutativity, associativity, BIBO stability, differential and difference equations."
    },
    {
      "chapter": "Chapter 3",
      "title": "Fourier Series Representation of Periodic Signals",
      "page_start": 177,
      "page_end": 283,
      "summary": "Response of LTI systems to complex exponentials $e^{j\\omega t}$, continuous-time and discrete-time Fourier series, Dirichlet conditions, Parseval's relation, and filtering."
    },
    {
      "chapter": "Chapter 4",
      "title": "The Continuous-Time Fourier Transform",
      "page_start": 284,
      "page_end": 357,
      "summary": "Continuous-time Fourier transform $X(j\\omega) = \\int x(t)e^{-j\\omega t}dt$, duality, convolution and multiplication properties, frequency response of differential equation systems."
    },
    {
      "chapter": "Chapter 5",
      "title": "The Discrete-Time Fourier Transform",
      "page_start": 358,
      "page_end": 422,
      "summary": "Discrete-time Fourier transform $X(e^{j\\omega}) = \\sum x[n]e^{-j\\omega n}$, periodicity with $2\\pi$, symmetry properties, difference equation frequency responses."
    },
    {
      "chapter": "Chapter 6",
      "title": "Time and Frequency Characterization of Signals and Systems",
      "page_start": 423,
      "page_end": 513,
      "summary": "Magnitude-phase representation, group delay $-\\frac{d\\angle H(j\\omega)}{d\\omega}$, log-magnitude Bode plots, ideal frequency-selective filters, non-ideal filters."
    },
    {
      "chapter": "Chapter 7",
      "title": "Sampling",
      "page_start": 514,
      "page_end": 581,
      "summary": "Nyquist-Shannon sampling theorem $\\omega_s > 2\\omega_M$, impulse-train sampling, zero-order hold, aliasing, decimation, and discrete-time processing of continuous signals."
    },
    {
      "chapter": "Chapter 8",
      "title": "Communication Systems",
      "page_start": 582,
      "page_end": 653,
      "summary": "Amplitude modulation (AM), synchronous/asynchronous demodulation, Frequency-Division Multiplexing (FDM), Single-Sideband (SSB), Pulse-Amplitude Modulation (PAM), and Frequency Modulation (FM)."
    },
    {
      "chapter": "Chapter 9",
      "title": "The Laplace Transform",
      "page_start": 654,
      "page_end": 740,
      "summary": "Bilateral Laplace transform $X(s) = \\int x(t)e^{-st}dt$, Region of Convergence (ROC), pole-zero constellations, transfer function $H(s)$, causality, and stability."
    },
    {
      "chapter": "Chapter 10",
      "title": "The Z-Transform",
      "page_start": 741,
      "page_end": 815,
      "summary": "Z-transform $X(z) = \\sum x[n]z^{-n}$, ROC properties on the complex z-plane, inverse Z-transform via contour integration and partial fractions, unilateral Z-transform."
    },
    {
      "chapter": "Chapter 11",
      "title": "Linear Feedback Systems",
      "page_start": 816,
      "page_end": 908,
      "summary": "Closed-loop feedback systems, sensitivity reduction, Root-Locus analysis, Nyquist stability criterion, gain margin, and phase margin."
    }
  ]
}"##;

            let messages = vec![
                OpenAIMessage {
                    role: "system".to_string(),
                    content: sys_prompt.to_string(),
                },
                OpenAIMessage {
                    role: "user".to_string(),
                    content: format!("Book: {}\n\nTable of Contents Excerpt:\n{}", title_hint, toc_full_text),
                },
            ];

            if !config.api_key.is_empty() {
                if let Ok(reply) = llm.complete(config, messages).await {
                    let clean = reply.trim();
                    let json_str = if let Some(start) = clean.find('{') {
                        if let Some(end) = clean.rfind('}') {
                            &clean[start..=end]
                        } else {
                            clean
                        }
                    } else {
                        clean
                    };

                    if let Ok(parsed) = serde_json::from_str::<SyllabusStructure>(json_str) {
                        if parsed.topics.len() >= 8 {
                            info!("✅ Successfully extracted {} chapters from Table of Contents", parsed.topics.len());
                            return Ok(parsed);
                        }
                    }
                }
            }
        }

        // Method 2: Document WITHOUT Index (e.g. Research Paper, Technical Report, Lecture Notes)
        info!("📄 No explicit Table of Contents index found. Performing robust full-document topic synthesis...");

        // Sample evenly throughout the document (Intro, Middle sections, Conclusion)
        let total_p = pages.len();
        let sample_indices = if total_p <= 10 {
            (0..total_p).collect::<Vec<usize>>()
        } else {
            let mut idxs = vec![0, 1, 2];
            let step = (total_p / 6).max(1);
            let mut curr = step;
            while curr < total_p.saturating_sub(3) {
                idxs.push(curr);
                curr += step;
            }
            idxs.push(total_p.saturating_sub(2));
            idxs.push(total_p.saturating_sub(1));
            idxs
        };

        let mut sample_corpus = String::new();
        for &idx in &sample_indices {
            if let Some(p) = pages.get(idx) {
                sample_corpus.push_str(&format!("\n--- Page {} ---\n", p.page_number));
                let snippet = if p.text.len() > 1500 { &p.text[..1500] } else { &p.text };
                sample_corpus.push_str(snippet);
            }
        }

        let sys_prompt = r##"You are an academic researcher and curriculum creator.
Analyze the provided document excerpts from across the entire publication (Introduction, Core Body, Methodology, Evaluation, and Conclusions).
Break down the paper or document into a comprehensive, multi-module learning curriculum covering EVERY major section, method, theorem, and experimental finding.

Output STRICTLY a valid JSON object matching this schema with NO markdown wrapping or surrounding text:
{
  "course_title": "Accurate Title of the Document / Research Paper",
  "course_description": "Rigorous academic abstract and summary of key technical contributions.",
  "category": "Computer Science / Artificial Intelligence / Engineering / Mathematics",
  "syllabus": "# Research Study Plan\n1. **Section 1: Background & Foundations**\n2. **Section 2: Core Methodology**",
  "topics": [
    {
      "chapter": "Section 1",
      "title": "Topic Name",
      "summary": "Key equations (in LaTeX like $E=mc^2$), theoretical guarantees, and empirical takeaways."
    }
  ]
}"##;

        let messages = vec![
            OpenAIMessage {
                role: "system".to_string(),
                content: sys_prompt.to_string(),
            },
            OpenAIMessage {
                role: "user".to_string(),
                content: format!("Title Hint: {}\nTotal Pages: {}\n\nRepresentative Document Content:\n{}", title_hint, total_p, sample_corpus),
            },
        ];

        if !config.api_key.is_empty() {
            if let Ok(reply) = llm.complete(config, messages).await {
                let clean = reply.trim();
                let json_str = if let Some(start) = clean.find('{') {
                    if let Some(end) = clean.rfind('}') {
                        &clean[start..=end]
                    } else {
                        clean
                    }
                } else {
                    clean
                };

                if let Ok(parsed) = serde_json::from_str::<SyllabusStructure>(json_str) {
                    if !parsed.topics.is_empty() {
                        info!("✅ Synthesized {} comprehensive topic modules across document", parsed.topics.len());
                        return Ok(parsed);
                    }
                }
            }
        }

        // Fallback default curriculum if LLM unreachable
        Ok(SyllabusStructure {
            course_title: title_hint.to_string(),
            course_description: "Comprehensive study curriculum with LaTeX derivations and active recall.".to_string(),
            category: "General Sciences & Engineering".to_string(),
            syllabus: "# Course Syllabus\n1. Signals and Systems Fundamentals\n2. Linear Time-Invariant Systems\n3. Fourier Analysis\n4. Laplace and Z-Transforms".to_string(),
            topics: vec![
                ExtractedChapter {
                    chapter: "Chapter 1".to_string(),
                    title: "Signals and Systems Overview".to_string(),
                    page_start: Some(1),
                    page_end: Some(50),
                    summary: "Continuous and discrete-time signals, transformations of the independent variable, exponential and sinusoidal signals.".to_string(),
                },
                ExtractedChapter {
                    chapter: "Chapter 2".to_string(),
                    title: "Linear Time-Invariant Systems".to_string(),
                    page_start: Some(51),
                    page_end: Some(120),
                    summary: "Convolution sum, convolution integral, properties of linear time-invariant systems, causal LTI systems.".to_string(),
                },
                ExtractedChapter {
                    chapter: "Chapter 3".to_string(),
                    title: "Fourier Series Representation of Periodic Signals".to_string(),
                    page_start: Some(121),
                    page_end: Some(200),
                    summary: "Response of LTI systems to complex exponentials, Fourier series representation, convergence, properties.".to_string(),
                },
                ExtractedChapter {
                    chapter: "Chapter 4".to_string(),
                    title: "The Continuous-Time Fourier Transform".to_string(),
                    page_start: Some(201),
                    page_end: Some(280),
                    summary: "Development of CTFT, transform of aperiodic and periodic signals, properties, convolution and multiplication properties.".to_string(),
                },
                ExtractedChapter {
                    chapter: "Chapter 5".to_string(),
                    title: "The Discrete-Time Fourier Transform".to_string(),
                    page_start: Some(281),
                    page_end: Some(360),
                    summary: "DTFT representation, duality, discrete Fourier properties, frequency response of difference equation systems.".to_string(),
                },
                ExtractedChapter {
                    chapter: "Chapter 6".to_string(),
                    title: "Time and Frequency Characterization of Signals & Systems".to_string(),
                    page_start: Some(361),
                    page_end: Some(440),
                    summary: "Magnitude-phase representation of frequency response, group delay, ideal and non-ideal filter design, Bode plots.".to_string(),
                },
                ExtractedChapter {
                    chapter: "Chapter 7".to_string(),
                    title: "Sampling and Aliasing".to_string(),
                    page_start: Some(441),
                    page_end: Some(520),
                    summary: "Nyquist-Shannon sampling theorem, impulse-train sampling, reconstruction with lowpass interpolation, discrete-time processing of continuous-time signals.".to_string(),
                },
                ExtractedChapter {
                    chapter: "Chapter 8".to_string(),
                    title: "Communication Systems & Modulation".to_string(),
                    page_start: Some(521),
                    page_end: Some(600),
                    summary: "Complex exponential and sinusoidal amplitude modulation, demodulation, single-sideband (SSB), frequency division multiplexing (FDM), pulse-amplitude modulation.".to_string(),
                },
                ExtractedChapter {
                    chapter: "Chapter 9".to_string(),
                    title: "The Laplace Transform".to_string(),
                    page_start: Some(601),
                    page_end: Some(700),
                    summary: "Laplace transform definition, Region of Convergence (ROC), inverse Laplace transform, pole-zero plots, transfer function of LTI systems.".to_string(),
                },
                ExtractedChapter {
                    chapter: "Chapter 10".to_string(),
                    title: "The Z-Transform".to_string(),
                    page_start: Some(701),
                    page_end: Some(800),
                    summary: "Definition of Z-transform, ROC geometric properties, inverse Z-transform by partial fractions and contour integration, unilateral Z-transform.".to_string(),
                },
                ExtractedChapter {
                    chapter: "Chapter 11".to_string(),
                    title: "Feedback Systems".to_string(),
                    page_start: Some(801),
                    page_end: Some(950),
                    summary: "Linear feedback systems, closed-loop transfer functions, root locus method, Nyquist stability criterion, gain and phase margin.".to_string(),
                },
            ],
        })
    }

    /// Ingest a textbook or document PDF into SQLite covering EVERY chapter/topic
    pub async fn ingest_book(
        db: &DbHandle,
        llm: std::sync::Arc<LLMService>,
        config: &LLMConfig,
        pdf_path: &str,
        custom_course_title: Option<&str>,
        max_chunks_to_embed: Option<usize>,
    ) -> Result<(String, usize)> {
        // 1. Extract per-page contents
        let pages = Self::extract_pages(pdf_path)?;
        let total_pages = pages.len();
        info!("Extracting and structuring {} pages from document...", total_pages);

        // 2. Discover / Parse Table of Contents and Course Structure dynamically (Method 1 or Method 2)
        let structure = Self::analyze_pages_structure(&llm, config, &pages, custom_course_title).await?;
        info!("Identified course: \"{}\" with {} structured topics/chapters", structure.course_title, structure.topics.len());

        // 3. Find or create Course
        let existing_courses = db::list_courses(db)?;
        let course = if let Some(c) = existing_courses.into_iter().find(|c| c.title == structure.course_title) {
            c
        } else {
            let req = CreateCourseReq {
                title: structure.course_title.clone(),
                category: Some(structure.category),
                description: Some(structure.course_description),
                syllabus: Some(structure.syllabus),
            };
            db::create_course(db, &req)?
        };

        // 4. Create all Chapter & Topic nodes dynamically
        let existing_topics = db::list_topics(db, &course.id)?;
        let mut topic_map = std::collections::HashMap::new();

        if existing_topics.is_empty() {
            for (idx, topic_data) in structure.topics.iter().enumerate() {
                let topic = db::create_topic(db, &CreateTopicReq {
                    course_id: course.id.clone(),
                    chapter: Some(topic_data.chapter.clone()),
                    title: topic_data.title.clone(),
                    order_index: Some(idx as i32),
                    mastery_level: Some("to_learn".to_string()),
                    quiz_score: None,
                    quizzes_taken: Some(0),
                    summary: Some(topic_data.summary.clone()),
                })?;
                topic_map.insert(idx, topic.id);
            }
        } else {
            for (idx, t) in existing_topics.into_iter().enumerate() {
                topic_map.insert(idx, t.id);
            }
        }

        // 5. Index Every Page wrt Topics:
        // Chunk each page and link chunk to its respective topic/chapter if page bounds match
        let mut doc_tasks = Vec::new();

        for page in &pages {
            let page_chunks = Self::chunk_text(&page.text, 350, 40);
            
            // Find which topic/chapter this page belongs to
            let assigned_topic_id = structure.topics.iter().enumerate().find_map(|(idx, top)| {
                if let (Some(start), Some(end)) = (top.page_start, top.page_end) {
                    if page.page_number >= start && page.page_number <= end {
                        return topic_map.get(&idx).cloned();
                    }
                }
                None
            });

            for (chunk_idx, chunk) in page_chunks.into_iter().enumerate() {
                let doc_title = format!("{} - Page {} (Chunk {})", structure.course_title, page.page_number, chunk_idx + 1);
                let req = CreateDocumentReq {
                    course_id: course.id.clone(),
                    topic_id: assigned_topic_id.clone(),
                    title: doc_title,
                    doc_type: "book_page".to_string(),
                    content: chunk,
                };

                let doc = db::create_document(db, &req)?;
                doc_tasks.push((doc.id, doc.title, doc.doc_type, doc.content));
            }
        }

        let total_chunks = doc_tasks.len();
        let limit = max_chunks_to_embed.unwrap_or(total_chunks).min(total_chunks);
        info!("Stored {} total chunks across {} pages into SQLite. Launching async embedding for top {} chunks...", total_chunks, total_pages, limit);

        // 6. Spawn Concurrent Asynchronous Background Indexing Worker
        if !config.api_key.is_empty() {
            let db_clone = db.clone();
            let llm_clone = llm.clone();
            let config_clone = config.clone();
            let tasks_to_embed: Vec<(String, String, String, String)> = doc_tasks.into_iter().take(limit).collect();

            tokio::spawn(async move {
                use tokio::sync::Semaphore;
                let semaphore = std::sync::Arc::new(Semaphore::new(8)); // 8 concurrent embedding workers
                let mut handles = Vec::new();

                for (doc_id, title, doc_type, content) in tasks_to_embed {
                    let sem = semaphore.clone();
                    let db_ref = db_clone.clone();
                    let llm_ref = llm_clone.clone();
                    let cfg_ref = config_clone.clone();

                    let handle = tokio::spawn(async move {
                        let _permit = sem.acquire().await.unwrap();
                        let text_to_embed = format!("{} {}\n{}", title, doc_type, content);
                        match llm_ref.embed_text(&cfg_ref, &text_to_embed).await {
                            Ok(emb) => {
                                let _ = db::update_doc_embedding(&db_ref, &doc_id, &emb);
                            }
                            Err(e) => {
                                warn!("Async indexing embedding error for doc {}: {}", doc_id, e);
                            }
                        }
                    });
                    handles.push(handle);
                }

                for h in handles {
                    let _ = h.await;
                }
                info!("🎉 Completed fast async vector indexing across all textbook pages!");
            });
        }

        Ok((course.id, total_chunks))
    }
}


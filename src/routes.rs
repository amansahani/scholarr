use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tracing::{error, info};

use crate::{
    db::{self, DbHandle},
    llm::{LLMService, OpenAIMessage},
    models::*,
    prompt::PromptBuilder,
};

#[derive(Clone)]
pub struct AppState {
    pub db: DbHandle,
    pub llm: Arc<LLMService>,
}

#[derive(Debug, Serialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
}

impl<T> ApiResponse<T> {
    pub fn ok(data: T) -> Json<ApiResponse<T>> {
        Json(ApiResponse {
            success: true,
            data: Some(data),
            error: None,
        })
    }

    pub fn err(msg: impl Into<String>) -> (StatusCode, Json<ApiResponse<T>>) {
        (
            StatusCode::BAD_REQUEST,
            Json(ApiResponse {
                success: false,
                data: None,
                error: Some(msg.into()),
            }),
        )
    }
}

// --- KNOWLEDGE GRAPH (Embedded SQLite Graph DB) ---
pub async fn get_knowledge_graph(State(state): State<AppState>) -> impl IntoResponse {
    match db::get_entire_graph(&state.db) {
        Ok(graph) => ApiResponse::ok(graph).into_response(),
        Err(e) => ApiResponse::<GraphDataResponse>::err(e.to_string()).into_response(),
    }
}


// --- USER PROFILE ---
pub async fn get_profile(State(state): State<AppState>) -> impl IntoResponse {
    match db::get_user_profile(&state.db) {
        Ok(profile) => ApiResponse::ok(profile).into_response(),
        Err(e) => ApiResponse::<UserProfile>::err(e.to_string()).into_response(),
    }
}

pub async fn update_profile(
    State(state): State<AppState>,
    Json(payload): Json<UserProfile>,
) -> impl IntoResponse {
    match db::update_user_profile(&state.db, &payload) {
        Ok(_) => match db::get_user_profile(&state.db) {
            Ok(p) => ApiResponse::ok(p).into_response(),
            Err(e) => ApiResponse::<UserProfile>::err(e.to_string()).into_response(),
        },
        Err(e) => ApiResponse::<UserProfile>::err(e.to_string()).into_response(),
    }
}

// --- LLM SETTINGS ---
pub async fn get_llm_config(State(state): State<AppState>) -> impl IntoResponse {
    match db::get_llm_config(&state.db) {
        Ok(mut config) => {
            if config.api_key.len() > 8 {
                let prefix = &config.api_key[..4];
                let suffix = &config.api_key[config.api_key.len() - 4..];
                config.api_key = format!("{}****{}", prefix, suffix);
            }
            ApiResponse::ok(config).into_response()
        }
        Err(e) => ApiResponse::<LLMConfig>::err(e.to_string()).into_response(),
    }
}

pub async fn save_llm_config(
    State(state): State<AppState>,
    Json(payload): Json<LLMConfig>,
) -> impl IntoResponse {
    let mut config_to_save = payload;
    if config_to_save.api_key.contains("****") {
        if let Ok(existing) = db::get_llm_config(&state.db) {
            config_to_save.api_key = existing.api_key;
        }
    }

    match db::save_llm_config(&state.db, &config_to_save) {
        Ok(_) => ApiResponse::ok("LLM Configuration Saved").into_response(),
        Err(e) => ApiResponse::<String>::err(e.to_string()).into_response(),
    }
}

pub async fn test_llm_connection(
    State(state): State<AppState>,
    Json(payload): Json<LLMConfig>,
) -> impl IntoResponse {
    let mut config_to_test = payload;
    if config_to_test.api_key.contains("****") || config_to_test.api_key.is_empty() {
        if let Ok(existing) = db::get_llm_config(&state.db) {
            config_to_test.api_key = existing.api_key;
        }
    }

    match state.llm.test_connection(&config_to_test).await {
        Ok(reply) => ApiResponse::ok(reply).into_response(),
        Err(e) => ApiResponse::<String>::err(e.to_string()).into_response(),
    }
}

// --- COURSES ---
pub async fn list_courses(State(state): State<AppState>) -> impl IntoResponse {
    match db::list_courses(&state.db) {
        Ok(courses) => ApiResponse::ok(courses).into_response(),
        Err(e) => ApiResponse::<Vec<Course>>::err(e.to_string()).into_response(),
    }
}

pub async fn get_course(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match db::get_course(&state.db, &id) {
        Ok(Some(course)) => ApiResponse::ok(course).into_response(),
        Ok(None) => ApiResponse::<Course>::err("Course not found").into_response(),
        Err(e) => ApiResponse::<Course>::err(e.to_string()).into_response(),
    }
}

pub async fn create_course(
    State(state): State<AppState>,
    Json(req): Json<CreateCourseReq>,
) -> impl IntoResponse {
    match db::create_course(&state.db, &req) {
        Ok(course) => ApiResponse::ok(course).into_response(),
        Err(e) => ApiResponse::<Course>::err(e.to_string()).into_response(),
    }
}

pub async fn update_course(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<UpdateCourseReq>,
) -> impl IntoResponse {
    match db::update_course(&state.db, &id, &req) {
        Ok(course) => ApiResponse::ok(course).into_response(),
        Err(e) => ApiResponse::<Course>::err(e.to_string()).into_response(),
    }
}

pub async fn delete_course(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match db::delete_course(&state.db, &id) {
        Ok(_) => ApiResponse::ok("Course deleted").into_response(),
        Err(e) => ApiResponse::<String>::err(e.to_string()).into_response(),
    }
}

// --- TOPICS ---
pub async fn list_topics(
    State(state): State<AppState>,
    Path(course_id): Path<String>,
) -> impl IntoResponse {
    match db::list_topics(&state.db, &course_id) {
        Ok(topics) => ApiResponse::ok(topics).into_response(),
        Err(e) => ApiResponse::<Vec<Topic>>::err(e.to_string()).into_response(),
    }
}

pub async fn create_topic(
    State(state): State<AppState>,
    Json(req): Json<CreateTopicReq>,
) -> impl IntoResponse {
    match db::create_topic(&state.db, &req) {
        Ok(topic) => ApiResponse::ok(topic).into_response(),
        Err(e) => ApiResponse::<Topic>::err(e.to_string()).into_response(),
    }
}

pub async fn update_topic(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<UpdateTopicReq>,
) -> impl IntoResponse {
    match db::update_topic(&state.db, &id, &req) {
        Ok(_) => ApiResponse::ok("Topic updated").into_response(),
        Err(e) => ApiResponse::<String>::err(e.to_string()).into_response(),
    }
}

pub async fn delete_topic(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match db::delete_topic(&state.db, &id) {
        Ok(_) => ApiResponse::ok("Topic deleted").into_response(),
        Err(e) => ApiResponse::<String>::err(e.to_string()).into_response(),
    }
}

// --- DOCUMENTS ---
pub async fn list_documents(
    State(state): State<AppState>,
    Path(course_id): Path<String>,
) -> impl IntoResponse {
    match db::list_documents(&state.db, &course_id) {
        Ok(docs) => ApiResponse::ok(docs).into_response(),
        Err(e) => ApiResponse::<Vec<CourseDocument>>::err(e.to_string()).into_response(),
    }
}

pub async fn create_document(
    State(state): State<AppState>,
    Json(req): Json<CreateDocumentReq>,
) -> impl IntoResponse {
    let db = state.db.clone();
    let llm = state.llm.clone();

    match db::create_document(&state.db, &req) {
        Ok(doc) => {
            // Asynchronously generate embeddings
            let doc_id = doc.id.clone();
            let text_to_embed = format!("{} {}\n{}", doc.title, doc.doc_type, doc.content);
            tokio::spawn(async move {
                if let Ok(config) = db::get_llm_config(&db) {
                    if !config.api_key.is_empty() {
                        if let Ok(emb) = llm.embed_text(&config, &text_to_embed).await {
                            let _ = db::update_doc_embedding(&db, &doc_id, &emb);
                            info!("Generated embedding for document: {}", doc_id);
                        }
                    }
                }
            });

            ApiResponse::ok(doc).into_response()
        }
        Err(e) => ApiResponse::<CourseDocument>::err(e.to_string()).into_response(),
    }
}

pub async fn delete_document(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match db::delete_document(&state.db, &id) {
        Ok(_) => ApiResponse::ok("Document deleted").into_response(),
        Err(e) => ApiResponse::<String>::err(e.to_string()).into_response(),
    }
}

// --- NOTES & BOOKMARKS ---
#[derive(Debug, Deserialize)]
pub struct NotesQuery {
    pub course_id: Option<String>,
    pub topic_id: Option<String>,
    pub bookmarked: Option<bool>,
    pub q: Option<String>,
}

pub async fn list_notes(
    State(state): State<AppState>,
    Query(query): Query<NotesQuery>,
) -> impl IntoResponse {
    let bookmarked = query.bookmarked.unwrap_or(false);
    match db::list_notes(
        &state.db,
        query.course_id.as_deref(),
        query.topic_id.as_deref(),
        bookmarked,
        query.q.as_deref(),
    ) {
        Ok(notes) => ApiResponse::ok(notes).into_response(),
        Err(e) => ApiResponse::<Vec<Note>>::err(e.to_string()).into_response(),
    }
}

pub async fn get_note(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match db::get_note(&state.db, &id) {
        Ok(Some(note)) => ApiResponse::ok(note).into_response(),
        Ok(None) => ApiResponse::<Note>::err("Note not found").into_response(),
        Err(e) => ApiResponse::<Note>::err(e.to_string()).into_response(),
    }
}

pub async fn create_note(
    State(state): State<AppState>,
    Json(req): Json<CreateNoteReq>,
) -> impl IntoResponse {
    let db = state.db.clone();
    let llm = state.llm.clone();

    match db::create_note(&state.db, &req) {
        Ok(note) => {
            let note_id = note.id.clone();
            let text_to_embed = format!("{} {}\n{}", note.title, note.tags.join(" "), note.content);
            tokio::spawn(async move {
                if let Ok(config) = db::get_llm_config(&db) {
                    if !config.api_key.is_empty() {
                        if let Ok(emb) = llm.embed_text(&config, &text_to_embed).await {
                            let _ = db::update_note_embedding(&db, &note_id, &emb);
                            info!("Indexed note embedding in SQLite: {}", note_id);
                        }
                    }
                }
            });

            ApiResponse::ok(note).into_response()
        }
        Err(e) => ApiResponse::<Note>::err(e.to_string()).into_response(),
    }
}

pub async fn update_note(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<UpdateNoteReq>,
) -> impl IntoResponse {
    let db = state.db.clone();
    let llm = state.llm.clone();

    match db::update_note(&state.db, &id, &req) {
        Ok(note) => {
            let note_id = note.id.clone();
            let text_to_embed = format!("{} {}\n{}", note.title, note.tags.join(" "), note.content);
            tokio::spawn(async move {
                if let Ok(config) = db::get_llm_config(&db) {
                    if !config.api_key.is_empty() {
                        if let Ok(emb) = llm.embed_text(&config, &text_to_embed).await {
                            let _ = db::update_note_embedding(&db, &note_id, &emb);
                            info!("Updated note embedding in SQLite: {}", note_id);
                        }
                    }
                }
            });

            ApiResponse::ok(note).into_response()
        }
        Err(e) => ApiResponse::<Note>::err(e.to_string()).into_response(),
    }
}

pub async fn toggle_bookmark_note(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match db::toggle_bookmark_note(&state.db, &id) {
        Ok(is_bookmarked) => ApiResponse::ok(is_bookmarked).into_response(),
        Err(e) => ApiResponse::<bool>::err(e.to_string()).into_response(),
    }
}

pub async fn delete_note(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match db::delete_note(&state.db, &id) {
        Ok(_) => ApiResponse::ok("Note deleted").into_response(),
        Err(e) => ApiResponse::<String>::err(e.to_string()).into_response(),
    }
}

// --- CHAT & AI TUTOR ---
#[derive(Debug, Deserialize)]
pub struct ChatHistoryQuery {
    pub course_id: Option<String>,
    pub topic_id: Option<String>,
}

pub async fn get_chat_history(
    State(state): State<AppState>,
    Query(query): Query<ChatHistoryQuery>,
) -> impl IntoResponse {
    match db::get_chat_history(
        &state.db,
        query.course_id.as_deref(),
        query.topic_id.as_deref(),
        50,
    ) {
        Ok(msgs) => ApiResponse::ok(msgs).into_response(),
        Err(e) => ApiResponse::<Vec<ChatMessage>>::err(e.to_string()).into_response(),
    }
}

pub async fn clear_chat_history(
    State(state): State<AppState>,
    Query(query): Query<ChatHistoryQuery>,
) -> impl IntoResponse {
    match db::clear_chat_history(
        &state.db,
        query.course_id.as_deref(),
        query.topic_id.as_deref(),
    ) {
        Ok(_) => ApiResponse::ok("Chat history cleared").into_response(),
        Err(e) => ApiResponse::<String>::err(e.to_string()).into_response(),
    }
}

pub async fn chat(
    State(state): State<AppState>,
    Json(req): Json<ChatRequest>,
) -> impl IntoResponse {
    let user_msg = req.message.trim();
    if user_msg.is_empty() {
        return ApiResponse::<ChatResponse>::err("Message cannot be empty").into_response();
    }

    // 1. Fetch Profile & LLM Config
    let profile = match db::get_user_profile(&state.db) {
        Ok(p) => p,
        Err(e) => return ApiResponse::<ChatResponse>::err(format!("Profile error: {}", e)).into_response(),
    };

    let llm_config = match db::get_llm_config(&state.db) {
        Ok(c) => c,
        Err(e) => return ApiResponse::<ChatResponse>::err(format!("LLM config error: {}", e)).into_response(),
    };

    // 2. Fetch Course Context
    let course = if let Some(ref cid) = req.course_id {
        db::get_course(&state.db, cid).unwrap_or(None)
    } else {
        None
    };

    // 3. Fetch Topic Context
    let topic = if let Some(ref tid) = req.topic_id {
        if let Some(ref c) = course {
            let topics = db::list_topics(&state.db, &c.id).unwrap_or_default();
            topics.into_iter().find(|t| t.id == *tid)
        } else {
            None
        }
    } else {
        None
    };

    // 4. Vector Semantic Search / RAG across Documents & Notes using liquid/lfm-2.5-embedding-350m:free
    let query_embedding = if !llm_config.api_key.is_empty() {
        state.llm.embed_text(&llm_config, user_msg).await.ok()
    } else {
        None
    };

    let mut sources_used = Vec::new();
    let mut source_items = Vec::new();

    // Documents retrieval via SQLite Vector Search
    let docs = if req.include_docs.unwrap_or(true) {
        if let Some(ref c) = course {
            if let Some(ref q_emb) = query_embedding {
                let matches = db::search_documents_vector(&state.db, Some(&c.id), q_emb, 4).unwrap_or_default();
                let mut top_docs = Vec::new();
                for (d, sim) in matches {
                    sources_used.push(format!("Doc: {}", d.title));
                    source_items.push(GroundedSource {
                        id: d.id.clone(),
                        title: d.title.clone(),
                        source_type: "doc".to_string(),
                        excerpt: d.content.chars().take(280).collect::<String>(),
                        similarity: Some((sim * 100.0).round() / 100.0),
                    });
                    top_docs.push(d);
                }
                top_docs
            } else {
                let all_docs = db::list_documents(&state.db, &c.id).unwrap_or_default();
                let top_docs: Vec<CourseDocument> = all_docs.into_iter().take(4).collect();
                for d in &top_docs {
                    sources_used.push(format!("Doc: {}", d.title));
                    source_items.push(GroundedSource {
                        id: d.id.clone(),
                        title: d.title.clone(),
                        source_type: "doc".to_string(),
                        excerpt: d.content.chars().take(280).collect::<String>(),
                        similarity: None,
                    });
                }
                top_docs
            }
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };

    // Notes retrieval (Ranked semantically)
    let notes = if req.include_notes.unwrap_or(true) {
        let mut n = db::list_notes(
            &state.db,
            req.course_id.as_deref(),
            req.topic_id.as_deref(),
            false,
            None,
        )
        .unwrap_or_default();

        if let Some(ref q_emb) = query_embedding {
            n.sort_by(|a, b| {
                let sim_a = a.embedding.as_ref().map(|v| LLMService::cosine_similarity(q_emb, v)).unwrap_or(0.0);
                let sim_b = b.embedding.as_ref().map(|v| LLMService::cosine_similarity(q_emb, v)).unwrap_or(0.0);
                sim_b.partial_cmp(&sim_a).unwrap_or(std::cmp::Ordering::Equal)
            });
        }

        let top_notes: Vec<Note> = n.into_iter().take(4).collect();
        for item in &top_notes {
            sources_used.push(format!("Note: {}", item.title));
            source_items.push(GroundedSource {
                id: item.id.clone(),
                title: item.title.clone(),
                source_type: "note".to_string(),
                excerpt: item.content.chars().take(280).collect::<String>(),
                similarity: None,
            });
        }
        top_notes
    } else {
        Vec::new()
    };

    if let Some(ref c) = course {
        if req.include_syllabus.unwrap_or(true) && !c.syllabus.trim().is_empty() {
            sources_used.push(format!("Syllabus: {}", c.title));
            source_items.push(GroundedSource {
                id: c.id.clone(),
                title: format!("Syllabus: {}", c.title),
                source_type: "syllabus".to_string(),
                excerpt: c.syllabus.chars().take(280).collect::<String>(),
                similarity: None,
            });
        }
    }

    // 5. Build System Prompt
    let system_prompt = PromptBuilder::build_system_prompt(
        &profile,
        course.as_ref(),
        topic.as_ref(),
        &docs,
        &notes,
    );

    // 6. Fetch previous recent messages
    let history = db::get_chat_history(
        &state.db,
        req.course_id.as_deref(),
        req.topic_id.as_deref(),
        8,
    )
    .unwrap_or_default();

    let mut llm_messages = Vec::new();
    llm_messages.push(OpenAIMessage {
        role: "system".to_string(),
        content: system_prompt,
    });

    for h in history {
        llm_messages.push(OpenAIMessage {
            role: h.role,
            content: h.content,
        });
    }

    llm_messages.push(OpenAIMessage {
        role: "user".to_string(),
        content: user_msg.to_string(),
    });

    // 7. Call LLM Service (e.g. poolside/laguna-s-2.1:free via OpenRouter)
    let reply = match state.llm.complete(&llm_config, llm_messages).await {
        Ok(ans) => ans,
        Err(e) => {
            error!("LLM call failed: {}", e);
            return ApiResponse::<ChatResponse>::err(format!("LLM Error: {}", e)).into_response();
        }
    };

    // 8. Save user and assistant messages to database
    let _ = db::save_chat_message(
        &state.db,
        req.course_id.as_deref(),
        req.topic_id.as_deref(),
        "user",
        user_msg,
    );

    let _ = db::save_chat_message(
        &state.db,
        req.course_id.as_deref(),
        req.topic_id.as_deref(),
        "assistant",
        &reply,
    );

    // 9. Generate suggested quick study note
    let suggested_note = if reply.contains("$$") || reply.len() > 150 {
        let title_candidate = if let Some(ref t) = topic {
            format!("Key Notes: {}", t.title)
        } else if let Some(ref c) = course {
            format!("Key Notes: {}", c.title)
        } else {
            "Concept Study Note".to_string()
        };

        Some(SuggestedNote {
            title: title_candidate,
            content: reply.clone(),
            tags: vec!["ai-tutor".to_string(), profile.tone.clone()],
        })
    } else {
        None
    };

    ApiResponse::ok(ChatResponse {
        reply,
        sources_used,
        source_items,
        suggested_note,
    })
    .into_response()
}

pub async fn generate_note(
    State(state): State<AppState>,
    Json(req): Json<GenerateNoteReq>,
) -> impl IntoResponse {
    let profile = db::get_user_profile(&state.db).unwrap_or_default();
    let llm_config = db::get_llm_config(&state.db).unwrap_or_default();

    let sys_prompt = format!(
        "You are an expert research note synthesizer.
The user wants you to create a structured study note with LaTeX equations ($...$ inline and $$...$$ block), key definitions, core formulas, conceptual takeaways, and bulleted summaries.
Target knowledge level: {}.
Return ONLY the formatted Markdown note content ready to be saved.",
        profile.knowledge_level
    );

    let mut user_content = format!("Synthesize a master study note on: {}", req.prompt);
    if let Some(src) = req.source_text {
        if !src.trim().is_empty() {
            user_content.push_str(&format!("\n\nSource reference:\n{}", src));
        }
    }

    let messages = vec![
        OpenAIMessage {
            role: "system".to_string(),
            content: sys_prompt,
        },
        OpenAIMessage {
            role: "user".to_string(),
            content: user_content,
        },
    ];

    match state.llm.complete(&llm_config, messages).await {
        Ok(content) => ApiResponse::ok(content).into_response(),
        Err(e) => ApiResponse::<String>::err(format!("Failed to generate note: {}", e)).into_response(),
    }
}

#[derive(Debug, Deserialize)]
pub struct IngestPdfReq {
    pub pdf_path: String,
    pub course_title: Option<String>,
    pub max_chunks: Option<usize>,
}

pub async fn ingest_pdf(
    State(state): State<AppState>,
    Json(req): Json<IngestPdfReq>,
) -> impl IntoResponse {
    let llm_config = match db::get_llm_config(&state.db) {
        Ok(c) => c,
        Err(e) => return ApiResponse::<String>::err(e.to_string()).into_response(),
    };

    match crate::ingest::PDFIngestion::ingest_book(
        &state.db,
        state.llm.clone(),
        &llm_config,
        &req.pdf_path,
        req.course_title.as_deref(),
        req.max_chunks,
    )
    .await
    {
        Ok((course_id, count)) => ApiResponse::ok(format!("Ingested {} chunks into Course ID: {}", count, course_id)).into_response(),
        Err(e) => ApiResponse::<String>::err(format!("PDF Ingestion failed: {}", e)).into_response(),
    }
}

// --- QUIZ & MASTERY STATS ENDPOINTS ---
pub async fn record_topic_score(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<RecordQuizScoreReq>,
) -> impl IntoResponse {
    match db::record_topic_quiz_score(&state.db, &id, payload.score) {
        Ok(t) => ApiResponse::ok(t).into_response(),
        Err(e) => ApiResponse::<Topic>::err(e.to_string()).into_response(),
    }
}

pub async fn get_stats_overview(
    State(state): State<AppState>,
) -> impl IntoResponse {
    match db::get_overview_stats(&state.db) {
        Ok(stats) => ApiResponse::ok(stats).into_response(),
        Err(e) => ApiResponse::<OverviewStats>::err(e.to_string()).into_response(),
    }
}

pub async fn generate_quiz(
    State(state): State<AppState>,
    Json(req): Json<GenerateQuizReq>,
) -> impl IntoResponse {
    let profile = db::get_user_profile(&state.db).unwrap_or_default();
    let llm_config = match db::get_llm_config(&state.db) {
        Ok(c) => c,
        Err(e) => return ApiResponse::<GeneratedQuizResponse>::err(e.to_string()).into_response(),
    };

    let difficulty = req.difficulty
        .filter(|d| !d.is_empty() && d != "adaptive")
        .unwrap_or_else(|| {
            if profile.quiz_difficulty != "adaptive" && !profile.quiz_difficulty.is_empty() {
                profile.quiz_difficulty.clone()
            } else {
                profile.knowledge_level.clone()
            }
        });

    let topic = if let Some(ref tid) = req.topic_id {
        db::get_topic(&state.db, tid).ok().flatten()
    } else {
        None
    };

    let course = if let Some(ref cid) = req.course_id {
        db::get_course(&state.db, cid).ok().flatten()
    } else if let Some(ref t) = topic {
        db::get_course(&state.db, &t.course_id).ok().flatten()
    } else {
        None
    };

    let topic_title = topic.as_ref().map(|t| t.title.clone())
        .or_else(|| course.as_ref().map(|c| c.title.clone()))
        .unwrap_or_else(|| "Core Science & Engineering Concepts".to_string());

    let sys_prompt = format!(
        "You are an expert examiner and pedagogy specialist designing an interactive active-recall quiz.
Topic: \"{}\"
Difficulty Level: \"{}\" (Rigorous, conceptual, and mathematically precise)
Math Requirement: MUST format all mathematical expressions with standard LaTeX ($...$ for inline, $$...$$ for block).

Generate 3 high-yield multiple-choice conceptual and analytical questions testing true depth and mastery.
CRITICAL REQUIREMENT: Ensure the correct answer is randomly distributed across options 'A', 'B', 'C', and 'D'. Do NOT make all correct answers option 'A'.
Each question must have 4 distinct, well-crafted options with only one unambiguously correct answer and plausible distractors.

Output STRICTLY a valid JSON object matching this schema with NO markdown wrapping or surrounding text:
{{
  \"questions\": [
    {{
      \"id\": 1,
      \"question\": \"Question text with LaTeX expressions e.g. $x(t)$ or $H(j\\\\omega)$\",
      \"options\": [
        \"A) Option text\",
        \"B) Option text\",
        \"C) Option text\",
        \"D) Option text\"
      ],
      \"hint\": \"Brief intuitive hint\",
      \"correct_option\": \"B\"
    }}
  ]
}}",
        topic_title, difficulty
    );

    let messages = vec![
        OpenAIMessage {
            role: "system".to_string(),
            content: sys_prompt,
        },
        OpenAIMessage {
            role: "user".to_string(),
            content: format!("Generate 3 multiple-choice quiz questions on: {}", topic_title),
        },
    ];

    match state.llm.complete(&llm_config, messages).await {
        Ok(reply) => {
            // Attempt JSON parse
            let clean_json = reply.trim();
            let json_str = if let Some(start) = clean_json.find('{') {
                if let Some(end) = clean_json.rfind('}') {
                    &clean_json[start..=end]
                } else {
                    clean_json
                }
            } else {
                clean_json
            };

            #[derive(Deserialize)]
            struct QuizJson {
                questions: Vec<QuizQuestion>,
            }

            match serde_json::from_str::<QuizJson>(json_str) {
                Ok(parsed) => {
                    ApiResponse::ok(GeneratedQuizResponse {
                        course_id: req.course_id,
                        topic_id: req.topic_id,
                        topic_title,
                        difficulty,
                        questions: parsed.questions,
                    })
                    .into_response()
                }
                Err(e) => {
                    // Fallback to manually constructed questions if JSON parse failed
                    info!("LLM Quiz JSON parse error: {}, falling back to standard format", e);
                    let fallback_questions = vec![
                        QuizQuestion {
                            id: 1,
                            question: format!("In the context of {}, which statement correctly characterizes its fundamental mathematical properties?", topic_title),
                            options: vec![
                                "A) It is non-linear and dependent strictly on initial system states.".to_string(),
                                "B) It produces unbounded output for all bounded input signals.".to_string(),
                                "C) It satisfies linearity, homogeneity, and time-invariance under standard boundary conditions.".to_string(),
                                "D) It violates causality in all physical domains.".to_string(),
                            ],
                            hint: Some("Consider the superposition principle and shift-invariance.".to_string()),
                            correct_option: Some("C".to_string()),
                        },
                        QuizQuestion {
                            id: 2,
                            question: format!("When analyzing {} in the frequency/transform domain, what is the primary advantage of the representation?", topic_title),
                            options: vec![
                                "A) Convolutions in the time domain convert to simple algebraic multiplications in the transform domain.".to_string(),
                                "B) It eliminates the need for mathematical rigor.".to_string(),
                                "C) It only applies to discrete periodic signals.".to_string(),
                                "D) The system becomes entirely memoryless.".to_string(),
                            ],
                            hint: Some("Think of the Convolution Theorem: $x(t) * h(t) \\longleftrightarrow X(j\\omega)H(j\\omega)$.".to_string()),
                            correct_option: Some("A".to_string()),
                        },
                        QuizQuestion {
                            id: 3,
                            question: format!("What is the critical stability or convergence condition associated with {}?", topic_title),
                            options: vec![
                                "A) The system must have infinite energy.".to_string(),
                                "B) The frequency response must be unbounded everywhere.".to_string(),
                                "C) All poles must lie strictly in the right-half s-plane.".to_string(),
                                "D) The impulse response must be absolutely integrable: $\\int_{-\\infty}^\\infty |h(t)| dt < \\infty$ (BIBO Stability).".to_string(),
                            ],
                            hint: Some("Recall Bounded-Input Bounded-Output (BIBO) stability.".to_string()),
                            correct_option: Some("D".to_string()),
                        },
                    ];

                    ApiResponse::ok(GeneratedQuizResponse {
                        course_id: req.course_id,
                        topic_id: req.topic_id,
                        topic_title,
                        difficulty,
                        questions: fallback_questions,
                    })
                    .into_response()
                }
            }
        }
        Err(e) => ApiResponse::<GeneratedQuizResponse>::err(format!("Quiz generation failed: {}", e)).into_response(),
    }
}

pub async fn submit_quiz(
    State(state): State<AppState>,
    Json(req): Json<SubmitQuizReq>,
) -> impl IntoResponse {
    let profile = db::get_user_profile(&state.db).unwrap_or_default();
    let llm_config = match db::get_llm_config(&state.db) {
        Ok(c) => c,
        Err(e) => return ApiResponse::<SubmitQuizResponse>::err(e.to_string()).into_response(),
    };

    let topic = if let Some(ref tid) = req.topic_id {
        db::get_topic(&state.db, tid).ok().flatten()
    } else {
        None
    };

    let topic_title = topic.as_ref().map(|t| t.title.clone()).unwrap_or_else(|| "Active Topic".to_string());
    let difficulty = req.difficulty.unwrap_or_else(|| profile.quiz_difficulty.clone());

    let mut submission_text = String::new();
    for (idx, ans) in req.answers.iter().enumerate() {
        submission_text.push_str(&format!(
            "Question {}: {}\nUser's Selected Answer: {}\nExpected/Target Option: {:?}\n\n",
            idx + 1,
            ans.question,
            ans.user_answer,
            ans.correct_option
        ));
    }

    let sys_prompt = format!(
        "You are an authoritative STEM professor and quiz grader evaluating a student's quiz submissions on \"{}\".
Grade each question rigorously. Provide detailed pedagogical feedback and step-by-step mathematical proofs/explanations using standard LaTeX ($...$ and $$...$$).

Output STRICTLY a valid JSON object matching this schema with NO wrapping markdown or explanation outside:
{{
  \"score_percentage\": 85.0,
  \"correct_count\": 2,
  \"total_questions\": 3,
  \"mastery_level\": \"mastered\",
  \"feedback\": [
    {{
      \"question_id\": 1,
      \"question\": \"...\",
      \"user_answer\": \"...\",
      \"correct_answer\": \"...\",
      \"is_correct\": true,
      \"explanation\": \"Detailed derivation & intuition in LaTeX\"
    }}
  ],
  \"overall_critique\": \"Comprehensive summary of the learner's conceptual understanding, strengths, and review recommendations.\"
}}",
        topic_title
    );

    let messages = vec![
        OpenAIMessage {
            role: "system".to_string(),
            content: sys_prompt,
        },
        OpenAIMessage {
            role: "user".to_string(),
            content: format!("Please grade this quiz submission:\n\n{}", submission_text),
        },
    ];

    let mut final_response = match state.llm.complete(&llm_config, messages).await {
        Ok(reply) => {
            let clean_json = reply.trim();
            let json_str = if let Some(start) = clean_json.find('{') {
                if let Some(end) = clean_json.rfind('}') {
                    &clean_json[start..=end]
                } else {
                    clean_json
                }
            } else {
                clean_json
            };

            match serde_json::from_str::<SubmitQuizResponse>(json_str) {
                Ok(mut parsed) => {
                    parsed.topic_id = req.topic_id.clone();
                    parsed.topic_title = Some(topic_title.clone());
                    parsed.difficulty = difficulty.clone();
                    parsed
                }
                Err(_) => {
                    // Manual heuristic grading if LLM didn't return strict JSON
                    let total = req.answers.len();
                    let mut correct = 0;
                    let mut feedback_items = Vec::new();

                    for (idx, ans) in req.answers.iter().enumerate() {
                        let is_corr = if let Some(ref target) = ans.correct_option {
                            ans.user_answer.trim().starts_with(target)
                        } else {
                            true
                        };
                        if is_corr {
                            correct += 1;
                        }

                        feedback_items.push(QuizFeedbackItem {
                            question_id: ans.question_id,
                            question: ans.question.clone(),
                            user_answer: ans.user_answer.clone(),
                            correct_answer: ans.correct_option.clone().unwrap_or_else(|| "A".to_string()),
                            is_correct: is_corr,
                            explanation: "Review the mathematical definitions and core properties in the notes.".to_string(),
                        });
                    }

                    let pct = if total > 0 { (correct as f32 / total as f32) * 100.0 } else { 0.0 };
                    let mastery = if pct >= 80.0 { "mastered" } else if pct >= 50.0 { "in_progress" } else { "review_needed" };

                    SubmitQuizResponse {
                        score_percentage: pct,
                        total_questions: total,
                        correct_count: correct,
                        mastery_level: mastery.to_string(),
                        topic_id: req.topic_id.clone(),
                        topic_title: Some(topic_title.clone()),
                        difficulty: difficulty.clone(),
                        feedback: feedback_items,
                        overall_critique: format!("You answered {} out of {} questions correctly ({:.1}%).", correct, total, pct),
                    }
                }
            }
        }
        Err(_) => {
            // Local fallback grading
            let total = req.answers.len();
            let correct = req.answers.iter().filter(|a| {
                if let Some(ref t) = a.correct_option {
                    a.user_answer.trim().starts_with(t)
                } else {
                    true
                }
            }).count();
            let pct = if total > 0 { (correct as f32 / total as f32) * 100.0 } else { 0.0 };
            let mastery = if pct >= 80.0 { "mastered" } else if pct >= 50.0 { "in_progress" } else { "review_needed" };

            SubmitQuizResponse {
                score_percentage: pct,
                total_questions: total,
                correct_count: correct,
                mastery_level: mastery.to_string(),
                topic_id: req.topic_id.clone(),
                topic_title: Some(topic_title.clone()),
                difficulty: difficulty.clone(),
                feedback: req.answers.iter().map(|a| QuizFeedbackItem {
                    question_id: a.question_id,
                    question: a.question.clone(),
                    user_answer: a.user_answer.clone(),
                    correct_answer: a.correct_option.clone().unwrap_or_default(),
                    is_correct: a.correct_option.as_ref().map(|co| a.user_answer.trim().starts_with(co)).unwrap_or(true),
                    explanation: "Step-by-step evaluation completed.".to_string(),
                }).collect(),
                overall_critique: format!("Calculated score: {:.1}% based on active recall response.", pct),
            }
        }
    };

    // If topic_id is present, persist the score to RocksDB
    if let Some(ref tid) = req.topic_id {
        if let Ok(updated_topic) = db::record_topic_quiz_score(&state.db, tid, final_response.score_percentage) {
            final_response.mastery_level = updated_topic.mastery_level;
        }
    }

    ApiResponse::ok(final_response).into_response()
}

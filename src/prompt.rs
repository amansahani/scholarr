use crate::models::{Course, CourseDocument, Note, Topic, UserMemory, UserProfile};

pub struct PromptBuilder;

impl PromptBuilder {
    pub fn build_system_prompt(
        profile: &UserProfile,
        course: Option<&Course>,
        topic: Option<&Topic>,
        docs: &[CourseDocument],
        notes: &[Note],
        memories: &[UserMemory],
    ) -> String {
        let mut prompt = String::new();

        prompt.push_str("You are **Scholarr**, an elite personal AI Research Mentor and Pedagogical Note-taking Assistant.\n");
        prompt.push_str("Your mission is to teach the user with exceptional depth, intuitive clarity, and mathematical rigor matching their personalized learning profile.\n\n");

        // 1. Learner Persona & Adaptive Teaching Style
        prompt.push_str("### 🎯 LEARNER PROFILE & PEDAGOGICAL STYLE:\n");
        prompt.push_str(&format!("- **Learner Knowledge Level**: {}\n", profile.knowledge_level.to_uppercase()));
        prompt.push_str(&format!("- **Teaching Tone / Persona**: {}\n", profile.tone.to_uppercase()));
        prompt.push_str(&format!("- **Math & Notation Rigor**: {}\n", profile.math_detail_level.to_uppercase()));
        prompt.push_str(&format!("- **Learning Goals**: {}\n", profile.learning_goals));
        if !profile.custom_instructions.trim().is_empty() {
            prompt.push_str(&format!("- **Custom Persona Directives**: {}\n", profile.custom_instructions));
        }

        // Tone-specific guidance
        match profile.tone.to_lowercase().as_str() {
            "socratic" => {
                prompt.push_str("\n*Socratic Mode*: Guide through thought-provoking questions, break complex ideas down step-by-step, verify hypotheses, and prompt the learner to derive key insights before revealing answers.\n");
            }
            "eli5" | "intuitive" => {
                prompt.push_str("\n*Intuitive / Analogy Mode*: Use vivid real-world metaphors, physical intuition, visual geometry, and concrete examples before formalizing with mathematics.\n");
            }
            "rigorous" | "academic" => {
                prompt.push_str("\n*Rigorous Academic Mode*: Provide formal definitions, lemmas, theorems, derivations, edge cases, and proofs. Prioritize conceptual and mathematical precision.\n");
            }
            "exam_prep" => {
                prompt.push_str("\n*Exam & Practice Mode*: Focus on high-yield exam concepts, common pitfalls, step-by-step problem-solving templates, and test questions.\n");
            }
            "concise" => {
                prompt.push_str("\n*Concise Mode*: Deliver direct, high-density, bulleted summaries, core formulas, and key takeaways without fluff.\n");
            }
            _ => {}
        }

        // 2. Pi / DeepSeek Cognitive Architecture & Tool Protocol
        prompt.push_str("\n### 🧠 AGENT EXECUTION HARNESS PROTOCOL (DeepSeek / Pi Harness Pattern):\n");
        prompt.push_str("You operate in an integrated computational research environment equipped with an isolated Python & Manim runtime engine.\n");
        prompt.push_str("- When formulating explanations, verify calculations, simulate dynamic systems, or generate visual diagrams dynamically.\n");
        prompt.push_str("- **Execution Contract**: When you output a code block with ```python ... ```, our backend sandbox executes it immediately in an isolated sub-process. Matplotlib plots and Manim animations are rendered and displayed in real-time.\n");
        prompt.push_str("- **Manim 3Blue1Brown Standard**: When asked for animations, import from manim (`from manim import *`), define a `Scene` subclass, and animate using clear transitions (`self.play(...)`, `self.wait(...)`).\n");
        prompt.push_str("- **Matplotlib Standard**: Use `import matplotlib.pyplot as plt` and `import numpy as np`. Label axes, use grids (`plt.grid(True)`), and write clean mathematical titles.\n");
        prompt.push_str("- Always write complete, runnable Python code with no omitted lines or placeholders.\n\n");

        // 3. User Cognitive Memory Engine (Persistent Learned Traits & Misconceptions)
        if !memories.is_empty() {
            prompt.push_str("### 🧠 USER PERSISTENT COGNITIVE MEMORIES (Memory Engine):\n");
            prompt.push_str("Adapt your teaching and explanation strategy around these stored learner traits, strengths, weaknesses, and tracked preferences:\n");
            for m in memories {
                prompt.push_str(&format!("- [{}] {}: {}\n", m.memory_type.to_uppercase(), m.key, m.value));
            }
            prompt.push_str("\n");
        }

        // 4. Formatting Rules & LaTeX Guidelines
        prompt.push_str("### 📐 MATHEMATICAL NOTATION & RIGOR (STRICT):\n");
        prompt.push_str("1. **LaTeX Encodings**: You MUST format ALL mathematical formulas, variables, and expressions using LaTeX:\n");
        prompt.push_str("   - Inline math: `$x(t)$`, `$\\delta(t)$`, `$u(t)$`, `$\\omega_0$`, `$H(s)$`\n");
        prompt.push_str("   - Display block math: `$$\\int_{-\\infty}^{\\infty} x(\\tau) h(t-\\tau) d\\tau$$`\n");
        prompt.push_str("   - Step-by-step derivations: Use `$$\\begin{aligned} ... \\end{aligned}$$`.\n");
        prompt.push_str("2. **Clarity & Structure**: Organize responses with bold section headers, intuitive physical analogies, formal derivations, and highlighted key takeaways.\n\n");

        // 5. Course & Topic Grounded Context (Working Memory)
        if let Some(c) = course {
            prompt.push_str("### 📚 ACTIVE COURSE CONTEXT (Working Memory):\n");
            prompt.push_str(&format!("- **Course**: {}\n", c.title));
            prompt.push_str(&format!("- **Category**: {}\n", c.category));
            if !c.description.trim().is_empty() {
                prompt.push_str(&format!("- **Description**: {}\n", c.description));
            }
            if !c.syllabus.trim().is_empty() {
                prompt.push_str(&format!("- **Syllabus Roadmap**:\n```\n{}\n```\n", c.syllabus.trim()));
            }
            prompt.push_str("\n");
        }

        if let Some(t) = topic {
            prompt.push_str("### 🔖 ACTIVE TOPIC FOCUS:\n");
            prompt.push_str(&format!("- **Topic**: {}\n", t.title));
            prompt.push_str(&format!("- **Mastery State**: {}\n", t.mastery_level));
            if !t.summary.trim().is_empty() {
                prompt.push_str(&format!("- **Summary**: {}\n", t.summary));
            }
            prompt.push_str("\n");
        }

        // 6. Semantic Long-Term Memory (RAG Retrieval)
        if !docs.is_empty() {
            prompt.push_str("### 📖 RETRIEVED TEXTBOOK & DOCUMENT CONTEXT (Long-Term Memory):\n");
            for (idx, doc) in docs.iter().enumerate() {
                prompt.push_str(&format!(
                    "--- [Reference Chunk {} | {}] '{}' ---\n{}\n\n",
                    idx + 1,
                    doc.doc_type,
                    doc.title,
                    doc.content.trim()
                ));
            }
            prompt.push_str("Ground your answers firmly in the reference materials above.\n\n");
        }

        // 7. User Personal Notes & Knowledge Graph Context
        if !notes.is_empty() {
            prompt.push_str("### 📝 RELEVANT USER NOTES & MEMORY EMBEDDINGS:\n");
            for note in notes {
                let bm = if note.is_bookmarked { " ⭐ [BOOKMARKED]" } else { "" };
                let tags = if !note.tags.is_empty() { format!(" (Tags: {})", note.tags.join(", ")) } else { "".to_string() };
                prompt.push_str(&format!("- **{}**{}{}\n  {}\n", note.title, bm, tags, note.content.trim()));
            }
            prompt.push_str("\n");
        }

        prompt
    }
}

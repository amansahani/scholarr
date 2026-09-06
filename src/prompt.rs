use crate::models::{Course, CourseDocument, Note, Topic, UserProfile};

pub struct PromptBuilder;

impl PromptBuilder {
    pub fn build_system_prompt(
        profile: &UserProfile,
        course: Option<&Course>,
        topic: Option<&Topic>,
        docs: &[CourseDocument],
        notes: &[Note],
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

        // 2. Formatting Rules & LaTeX Guidelines
        prompt.push_str("\n### 📐 MATHEMATICAL NOTATION & FORMATTING GUIDELINES (STRICT):\n");
        prompt.push_str("1. **LaTeX Required**: You MUST format ALL mathematical expressions, variables, formulas, and matrices using standard LaTeX with dollar signs:\n");
        prompt.push_str("   - Inline variables and formulas MUST use single dollar signs: e.g. `$x(t)$`, `$\\delta(t)$`, `$u(t)$`, `$\\omega_0$`, `$H(s)$`.\n");
        prompt.push_str("   - Display block equations MUST use double dollar signs on their own lines:\n$$\n\\int_{-\\infty}^{\\infty} x(\\tau) h(t-\\tau) d\\tau\n$$\n");
        prompt.push_str("   - Multi-step derivations: Use `$$\\begin{aligned} ... \\end{aligned}$$`.\n");
        prompt.push_str("   - DO NOT use plain parentheses `(x(t))` or brackets `[ ... ]` for equations. Always use `$ ... $` and `$$ ... $$`.\n");
        prompt.push_str("2. **Executable Python & 3Blue1Brown (Manim) Visualizations (AUTO-EXECUTED)**:\n");
        prompt.push_str("   - You MUST write complete, self-contained, executable code directly inside markdown Python code blocks (```python ... ```).\n");
        prompt.push_str("   - DO NOT output fake tool calling markup such as `<|tool_call_start|>` or `execute_bash(...)`. Just write the actual Python code directly in ````python ... ```` blocks!\n");
        prompt.push_str("   - For standard graphs & diagrams: Use `matplotlib.pyplot` and `numpy` (e.g. `import numpy as np`, `import matplotlib.pyplot as plt`). Call `plt.plot(...)`, `plt.title(...)`, `plt.grid(True)`.\n");
        prompt.push_str("   - For 3Blue1Brown animations: Write a `from manim import *` Scene class (e.g. `class TransformScene(Scene): def construct(self): ...`).\n");
        prompt.push_str("   - The Scholarr interactive studio detects ````python```` blocks and AUTOMATICALLY executes them in our backend Python sandbox to display the live interactive diagram or animation video.\n");
        prompt.push_str("3. **Structure**: Organize answers with bold markdown headers (`###`), bullet points, intuitive summaries, and actionable study takeaways.\n");
        prompt.push_str("4. **Study Notes**: Whenever explaining an important concept, highlight a concise **Key Takeaway** or **Note Card** block so the user can easily bookmark or save it.\n\n");

        // 3. Course Context
        if let Some(c) = course {
            prompt.push_str("### 📚 ACTIVE COURSE CONTEXT:\n");
            prompt.push_str(&format!("- **Course Title**: {}\n", c.title));
            prompt.push_str(&format!("- **Category**: {}\n", c.category));
            if !c.description.trim().is_empty() {
                prompt.push_str(&format!("- **Description**: {}\n", c.description));
            }
            if !c.syllabus.trim().is_empty() {
                prompt.push_str(&format!("- **Course Syllabus / Roadmap**:\n```\n{}\n```\n", c.syllabus.trim()));
            }
            prompt.push_str("\n");
        }

        // 4. Topic Context
        if let Some(t) = topic {
            prompt.push_str("### 🔖 CURRENT TOPIC FOCUS:\n");
            prompt.push_str(&format!("- **Topic**: {}\n", t.title));
            prompt.push_str(&format!("- **Mastery State**: {}\n", t.mastery_level));
            if !t.summary.trim().is_empty() {
                prompt.push_str(&format!("- **Topic Overview**: {}\n", t.summary));
            }
            prompt.push_str("\n");
        }

        // 5. Attached Documents & Textbook Reference Materials
        if !docs.is_empty() {
            prompt.push_str("### 📖 REFERENCE MATERIALS & UPLOADED DOCUMENTS:\n");
            for (idx, doc) in docs.iter().enumerate() {
                prompt.push_str(&format!(
                    "--- Document {} [{}]: '{}' ---\n{}\n\n",
                    idx + 1,
                    doc.doc_type,
                    doc.title,
                    doc.content.trim()
                ));
            }
            prompt.push_str("Reference the materials above accurately when answering.\n\n");
        }

        // 6. User's Personal Notes & Bookmarks
        if !notes.is_empty() {
            prompt.push_str("### 📝 RELEVANT USER NOTES & BOOKMARKS:\n");
            for note in notes {
                let bm = if note.is_bookmarked { " ⭐ [BOOKMARKED]" } else { "" };
                let tags = if !note.tags.is_empty() { format!(" (Tags: {})", note.tags.join(", ")) } else { "".to_string() };
                prompt.push_str(&format!("- **Note: {}**{}{}\n  {}\n", note.title, bm, tags, note.content.trim()));
            }
            prompt.push_str("\n");
        }

        prompt
    }
}

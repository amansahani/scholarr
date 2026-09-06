# 🎓 Scholarr - Personal AI Research Mentor & Note Taker

**Scholarr** is a high-performance personal learning, research tutor, and LaTeX note-taking application built in **Rust (Axum + Tokio + SQLite)** with a modern, responsive Web UI.

It turns your syllabus, textbook excerpts, and research notes into an interactive, personalized pedagogical mentor that teaches according to your knowledge level, learning persona, and rigorous LaTeX mathematical notation.

---

## ✨ Key Features

- 🦉 **Personalized AI Mentor**:
  - Choose between teaching personas: **Socratic Mentor** (guiding questions), **Intuitive Analogy (ELI5)**, **Rigorous Academic (MIT/Prof)**, **Exam & High-Yield Prep**, and **Ultra-Concise**.
  - Adaptive knowledge level: *Beginner*, *Intermediate*, *Advanced*, *Expert*.
  - Configurable math rigor and custom persona directives.

- 📐 **First-Class LaTeX Math & Markdown Support**:
  - Live KaTeX rendering for inline (`$E = mc^2$`) and block display equations (`$$\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}$$`).
  - Dark-mode optimized equation rendering and syntax highlighting for code blocks.

- 📚 **Course & Syllabus Hub**:
  - Create and manage courses with categorized domains.
  - Interactive syllabus viewer/editor that grounds the AI tutor with your exact curriculum.
  - Topic modules with mastery status tracking: *To Learn*, *In Progress*, *Mastered*, *Review Needed*.

- 📝 **Study Notes & Bookmark Vault**:
  - Markdown + LaTeX notes editor with live split-screen preview.
  - Instant full-text search across titles, content, and tags.
  - ⭐ **One-Click Bookmarking**: Bookmark high-yield notes for quick revision queues.
  - **AI Note Synthesizer**: Turn any chat explanation into a structured study note with one click (`Save as Note` or `Synthesize with AI`).

- 📖 **Textbook & Knowledge Vault**:
  - Attach textbook chapters, research papers, and lecture notes directly to courses.
  - The AI tutor uses uploaded documents to provide accurate references and explanations.

- 🔌 **LLM-Agnostic Engine with Vector Embeddings**:
  - Configured with OpenRouter models by default:
    - **Chat / Reasoning**: `poolside/laguna-s-2.1:free`
    - **Vector Embeddings (RAG)**: `liquid/lfm-2.5-embedding-350m:free`
  - Also compatible with:
    - **Google Gemini** (`gemini-2.5-flash`, `gemini-2.5-pro`)
    - **OpenAI** (`gpt-4o`, `gpt-4o-mini`, `o3-mini`)
    - **Groq** (`llama-3.3-70b-versatile`)
    - **Ollama** (`llama3.2`, `deepseek-r1`, `qwen2.5`)
    - **OpenRouter Multi-model** (`deepseek/deepseek-chat`, `anthropic/claude-3.5-sonnet`)
    - **Custom Endpoints** (vLLM, LocalAI, Together AI, Mistral)
  - Configure via `.env` or directly inside the Web UI Settings modal with live connection testing!

---

## 🚀 Quick Start

### 1. Configure Environment

Copy `.env.example` to `.env` and set your API key:

```bash
cp .env.example .env
```

Edit `.env` (or configure via the Web UI Settings modal):

```env
PORT=8080
DATABASE_URL=scholarr.db

# Example: Google Gemini (default)
LLM_PROVIDER=gemini
LLM_API_KEY=your_gemini_api_key_here
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
LLM_MODEL=gemini-2.5-flash
```

### 2. Run the Application

```bash
cargo run
```

### 3. Open the Web App

Open your browser and navigate to:
```
http://localhost:8080
```

---

## 🏗️ Architecture & Project Structure

```
scholarr/
├── Cargo.toml          # Rust dependencies (Axum 0.8, Rusqlite, Tokio, Reqwest, Serde)
├── .env.example        # Sample environment configurations for multiple LLM providers
├── src/
│   ├── main.rs         # Server initialization, Axum router & static file serving
│   ├── models.rs       # Data structures for Course, Topic, Note, Document, Profile, LLMConfig
│   ├── db.rs           # SQLite schema and thread-safe connection pool (r2d2 + rusqlite)
│   ├── llm.rs          # Universal LLM client with endpoint resolver & connection tester
│   ├── prompt.rs       # Context-aware prompt builder (injects persona, syllabus, notes, docs)
│   └── routes.rs       # REST API endpoints for all modules
└── static/
    ├── index.html      # Responsive Single Page Application
    ├── styles.css      # Custom styles & KaTeX / Markdown formatting
    └── app.js          # Client-side reactivity, KaTeX math rendering & API integrations
```

---

## 📡 API Overview

| Endpoint | Method | Description |
|---|---|---|
| `/api/profile` | GET / PUT | Get or update personalized learner profile |
| `/api/settings/llm` | GET / PUT | Configure LLM provider, base URL, and API key |
| `/api/settings/llm/test` | POST | Test LLM endpoint connection |
| `/api/courses` | GET / POST | List all courses or create a course |
| `/api/courses/{id}` | GET / PUT / DELETE | Manage specific course & syllabus |
| `/api/courses/{id}/topics` | GET | List topics in a course |
| `/api/topics` | POST | Create a new topic with mastery status |
| `/api/topics/{id}` | PUT / DELETE | Update topic mastery or delete |
| `/api/courses/{id}/docs` | GET | List documents in knowledge vault |
| `/api/docs` | POST | Upload/paste textbook chapters or papers |
| `/api/docs/{id}` | DELETE | Remove document |
| `/api/notes` | GET / POST | Search and list notes (supports tags, filters, bookmarks) |
| `/api/notes/{id}` | GET / PUT / DELETE | Manage specific study note |
| `/api/notes/{id}/bookmark` | POST | Toggle bookmark status on a note |
| `/api/chat` | POST | Send query to AI tutor with active context |
| `/api/chat/history` | GET / DELETE | Retrieve or clear conversation history |
| `/api/generate-note` | POST | Synthesize a structured LaTeX study note |

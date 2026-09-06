use axum::{
    routing::{delete, get, post, put},
    Router,
};
use std::{net::SocketAddr, sync::Arc};
use tower_http::{
    cors::{Any, CorsLayer},
    services::ServeDir,
    trace::TraceLayer,
};
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod db;
mod execute;
mod ingest;
mod llm;
mod models;
mod prompt;
mod routes;

use routes::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // 1. Load environment variables
    dotenvy::dotenv().ok();

    // 2. Initialize tracing
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "scholarr=info,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    // 3. Database initialization (SQLite: Relational + Vector + Knowledge Graph)
    let db_path = std::env::var("DATABASE_URL").unwrap_or_else(|_| "scholarr.db".to_string());
    info!("Initializing Unified SQLite database at: {}", db_path);
    let db = db::init_db(&db_path)?;

    // 4. LLM Service
    let llm_service = Arc::new(llm::LLMService::new());

    let state = AppState {
        db,
        llm: llm_service,
    };

    // 5. Build Router
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let api_routes = Router::new()
        // Profile
        .route("/profile", get(routes::get_profile).put(routes::update_profile))
        // LLM Config
        .route("/settings/llm", get(routes::get_llm_config).put(routes::save_llm_config))
        .route("/settings/llm/test", post(routes::test_llm_connection))
        // Knowledge Graph (Unified SQLite Graph Engine)
        .route("/graph/data", get(routes::get_knowledge_graph))
        // Courses
        .route("/courses", get(routes::list_courses).post(routes::create_course))
        .route(
            "/courses/{id}",
            get(routes::get_course)
                .put(routes::update_course)
                .delete(routes::delete_course),
        )
        // Topics
        .route("/courses/{id}/topics", get(routes::list_topics))
        .route("/topics", post(routes::create_topic))
        .route(
            "/topics/{id}",
            put(routes::update_topic).delete(routes::delete_topic),
        )
        .route("/topics/{id}/score", post(routes::record_topic_score))
        // Documents (Vector RAG Store)
        .route("/courses/{id}/docs", get(routes::list_documents))
        .route("/docs", post(routes::create_document))
        .route("/docs/{id}", delete(routes::delete_document))
        // Notes (Zettelkasten / Markdown)
        .route("/notes", get(routes::list_notes).post(routes::create_note))
        .route(
            "/notes/{id}",
            get(routes::get_note)
                .put(routes::update_note)
                .delete(routes::delete_note),
        )
        .route("/notes/{id}/bookmark", post(routes::toggle_bookmark_note))
        // Stats
        .route("/stats/overview", get(routes::get_stats_overview))
        // Quiz Engine
        .route("/quiz/generate", post(routes::generate_quiz))
        .route("/quiz/submit", post(routes::submit_quiz))
        // Chat & AI Tutor
        .route(
            "/chat/history",
            get(routes::get_chat_history).delete(routes::clear_chat_history),
        )
        .route("/chat", post(routes::chat))
        .route("/generate-note", post(routes::generate_note))
        .route("/ingest/pdf", post(routes::ingest_pdf))
        // Cognitive Memory Engine (Learner Profiles, Traits, Misconceptions)
        .route("/memories", get(routes::get_memories).post(routes::create_memory))
        .route("/memories/{id}", delete(routes::delete_memory))
        // Code Execution & Sandbox Visualizer
        .route("/execute/python", post(execute::execute_python_code))
        .route("/execute/repair", post(routes::repair_code))
        .with_state(state);

    // Serve static files
    let static_service = ServeDir::new("static")
        .append_index_html_on_directories(true);

    let app = Router::new()
        .nest("/api", api_routes)
        .fallback_service(static_service)
        .layer(cors)
        .layer(TraceLayer::new_for_http());

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8080);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));

    println!("===========================================================");
    println!("🎓  SCHOLARR - Unified SQLite (Relational, Vector & Graph)🎓");
    println!("===========================================================");
    println!(" Server listening on: http://localhost:{}", port);
    println!(" Database: {}", db_path);
    println!(" Ready with LLM Engine, LaTeX Math & Obsidian Graph!");
    println!("===========================================================\n");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

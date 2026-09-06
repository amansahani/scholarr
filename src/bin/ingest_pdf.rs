use anyhow::Result;
use tracing::info;

#[path = "../db.rs"]
mod db;
#[path = "../ingest.rs"]
mod ingest;
#[path = "../llm.rs"]
mod llm;
#[path = "../models.rs"]
mod models;

#[tokio::main]
async fn main() -> Result<()> {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt::init();

    let args: Vec<String> = std::env::args().collect();
    let default_pdf = "/Users/amansahani/Downloads/Signals_and_Systems_2nd_Edition_by_Oppen.pdf".to_string();
    let pdf_path = args.get(1).unwrap_or(&default_pdf);

    println!("===========================================================");
    println!("📚  SCHOLARR - PDF Textbook Ingestion & Embeddings Pipeline 📚");
    println!("===========================================================");
    println!(" PDF Source: {}", pdf_path);

    let db_path = std::env::var("DATABASE_URL").unwrap_or_else(|_| "scholarr.db".to_string());
    println!(" Target Database (SQLite): {}", db_path);
    let db = db::init_db(&db_path)?;

    let llm_service = std::sync::Arc::new(llm::LLMService::new());
    let config = db::get_llm_config(&db)?;

    println!(" LLM Provider: {}", config.provider);
    println!(" Chat Model: {}", config.model);
    println!(" Embedding Model: {}", config.embedding_model);
    println!("===========================================================\n");

    info!("Starting PDF ingestion and vector embedding...");
    let (course_id, chunks_count) = ingest::PDFIngestion::ingest_book(
        &db,
        llm_service,
        &config,
        pdf_path,
        Some("Signals & Systems (Oppenheim 2nd Ed.)"),
        None, // Full indexing across every page
    )
    .await?;

    println!("\n✅ Successfully ingested {} chunks into Course ID: {}", chunks_count, course_id);
    println!("🎉 The textbook is now fully searchable via semantic vector embeddings in Scholarr!");
    println!("===========================================================\n");

    Ok(())
}

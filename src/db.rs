use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use std::sync::{Arc, Mutex};
use uuid::Uuid;

use crate::models::*;

pub type DbHandle = Arc<Mutex<Connection>>;

/// Convert slice of f32 to raw binary blob for SQLite storage
pub fn vector_to_blob(vec: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(vec.len() * 4);
    for val in vec {
        bytes.extend_from_slice(&val.to_le_bytes());
    }
    bytes
}

/// Convert raw binary blob back to Vec<f32>
pub fn blob_to_vector(blob: &[u8]) -> Vec<f32> {
    let mut vec = Vec::with_capacity(blob.len() / 4);
    for chunk in blob.chunks_exact(4) {
        let arr: [u8; 4] = chunk.try_into().unwrap_or([0; 4]);
        vec.push(f32::from_le_bytes(arr));
    }
    vec
}

/// Calculate cosine similarity between two vectors
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.is_empty() || b.is_empty() || a.len() != b.len() {
        return 0.0;
    }
    let mut dot = 0.0f32;
    let mut norm_a = 0.0f32;
    let mut norm_b = 0.0f32;
    for (x, y) in a.iter().zip(b.iter()) {
        dot += x * y;
        norm_a += x * x;
        norm_b += y * y;
    }
    let denom = norm_a.sqrt() * norm_b.sqrt();
    if denom == 0.0 {
        0.0
    } else {
        dot / denom
    }
}

pub fn init_db(db_path: &str) -> Result<DbHandle> {
    let conn = Connection::open(db_path)
        .with_context(|| format!("Failed to open SQLite database at {}", db_path))?;

    // Optimize SQLite settings (WAL mode, fast synchronous, foreign keys)
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;

         -- User Profiles
         CREATE TABLE IF NOT EXISTS user_profiles (
             id TEXT PRIMARY KEY DEFAULT 'default',
             name TEXT NOT NULL,
             tone TEXT NOT NULL,
             knowledge_level TEXT NOT NULL,
             learning_goals TEXT NOT NULL,
             math_detail_level TEXT NOT NULL,
             quiz_difficulty TEXT NOT NULL DEFAULT 'adaptive',
             custom_instructions TEXT NOT NULL,
             updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
         );

         -- LLM Configuration
         CREATE TABLE IF NOT EXISTS llm_settings (
             id TEXT PRIMARY KEY DEFAULT 'default',
             provider TEXT NOT NULL,
             api_key TEXT NOT NULL,
             base_url TEXT NOT NULL,
             model TEXT NOT NULL,
             embedding_model TEXT NOT NULL,
             temperature REAL DEFAULT 0.7,
             max_tokens INTEGER DEFAULT 4096,
             updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
         );

         -- Courses
         CREATE TABLE IF NOT EXISTS courses (
             id TEXT PRIMARY KEY,
             title TEXT NOT NULL,
             description TEXT NOT NULL,
             category TEXT NOT NULL,
             syllabus TEXT NOT NULL DEFAULT '',
             created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
             updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
         );

         -- Topics
         CREATE TABLE IF NOT EXISTS topics (
             id TEXT PRIMARY KEY,
             course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
             chapter TEXT NOT NULL,
             title TEXT NOT NULL,
             order_index INTEGER NOT NULL DEFAULT 0,
             mastery_level TEXT NOT NULL DEFAULT 'to_learn',
             quiz_score REAL,
             quizzes_taken INTEGER DEFAULT 0,
             last_quiz_date DATETIME,
             summary TEXT NOT NULL DEFAULT '',
             created_at DATETIME DEFAULT CURRENT_TIMESTAMP
         );

         -- Documents & Embeddings (Vector Store)
         CREATE TABLE IF NOT EXISTS documents (
             id TEXT PRIMARY KEY,
             course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
             topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
             title TEXT NOT NULL,
             doc_type TEXT NOT NULL,
             content TEXT NOT NULL,
             embedding_blob BLOB,
             dimensions INTEGER,
             created_at DATETIME DEFAULT CURRENT_TIMESTAMP
         );

         -- Notes & Embeddings
         CREATE TABLE IF NOT EXISTS notes (
             id TEXT PRIMARY KEY,
             course_id TEXT REFERENCES courses(id) ON DELETE SET NULL,
             topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
             title TEXT NOT NULL,
             content TEXT NOT NULL,
             tags_json TEXT NOT NULL DEFAULT '[]',
             is_bookmarked BOOLEAN NOT NULL DEFAULT 0,
             embedding_blob BLOB,
             created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
             updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
         );

         -- Knowledge Graph Nodes & Edges (Obsidian Graph & Wikilinks)
         CREATE TABLE IF NOT EXISTS graph_nodes (
             id TEXT PRIMARY KEY,
             label TEXT NOT NULL,
             node_type TEXT NOT NULL,
             metadata_json TEXT NOT NULL DEFAULT '{}'
         );

         CREATE TABLE IF NOT EXISTS graph_edges (
             source_id TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
             target_id TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
             relation TEXT NOT NULL,
             weight REAL NOT NULL DEFAULT 1.0,
             PRIMARY KEY (source_id, target_id, relation)
         );

         -- Chat History
         CREATE TABLE IF NOT EXISTS chat_history (
             id TEXT PRIMARY KEY,
             course_id TEXT REFERENCES courses(id) ON DELETE CASCADE,
             topic_id TEXT REFERENCES topics(id) ON DELETE CASCADE,
             role TEXT NOT NULL,
             content TEXT NOT NULL,
             created_at DATETIME DEFAULT CURRENT_TIMESTAMP
         );

         -- Indices
         CREATE INDEX IF NOT EXISTS idx_topics_course ON topics(course_id);
         CREATE INDEX IF NOT EXISTS idx_docs_course ON documents(course_id);
         CREATE INDEX IF NOT EXISTS idx_notes_course ON notes(course_id);
         CREATE INDEX IF NOT EXISTS idx_graph_edges_src ON graph_edges(source_id);
         CREATE INDEX IF NOT EXISTS idx_graph_edges_tgt ON graph_edges(target_id);
         CREATE INDEX IF NOT EXISTS idx_chat_history_course ON chat_history(course_id);
        "
    )?;

    // Perform migrations for existing DBs if needed
    let _ = conn.execute("ALTER TABLE topics ADD COLUMN chapter TEXT NOT NULL DEFAULT 'Chapter 1'", []);
    let _ = conn.execute("ALTER TABLE topics ADD COLUMN quiz_score REAL", []);
    let _ = conn.execute("ALTER TABLE topics ADD COLUMN quizzes_taken INTEGER DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE topics ADD COLUMN last_quiz_date DATETIME", []);
    let _ = conn.execute("ALTER TABLE documents ADD COLUMN doc_type TEXT NOT NULL DEFAULT 'textbook'", []);
    let _ = conn.execute("ALTER TABLE documents ADD COLUMN dimensions INTEGER", []);
    let _ = conn.execute("ALTER TABLE notes ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]'", []);
    let _ = conn.execute("ALTER TABLE notes ADD COLUMN embedding_blob BLOB", []);

    let handle = Arc::new(Mutex::new(conn));

    // Seed default profile if absent
    if get_user_profile(&handle).is_err() {
        let def = UserProfile::default();
        let _ = update_user_profile(&handle, &def);
    }

    Ok(handle)
}

// ================= USER PROFILE =================
pub fn get_user_profile(db: &DbHandle) -> Result<UserProfile> {
    let conn = db.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT id, name, tone, knowledge_level, learning_goals, math_detail_level, quiz_difficulty, custom_instructions, updated_at
         FROM user_profiles WHERE id = 'default' LIMIT 1"
    )?;

    let profile = stmt.query_row([], |row| {
        let updated_str: String = row.get(8)?;
        Ok(UserProfile {
            id: row.get(0)?,
            name: row.get(1)?,
            tone: row.get(2)?,
            knowledge_level: row.get(3)?,
            learning_goals: row.get(4)?,
            math_detail_level: row.get(5)?,
            quiz_difficulty: row.get(6)?,
            custom_instructions: row.get(7)?,
            updated_at: DateTime::parse_from_rfc3339(&updated_str).map(|d| d.with_timezone(&Utc)).unwrap_or_else(|_| Utc::now()),
        })
    }).optional()?;

    Ok(profile.unwrap_or_default())
}

pub fn update_user_profile(db: &DbHandle, p: &UserProfile) -> Result<()> {
    let conn = db.lock().unwrap();
    let now = Utc::now();
    conn.execute(
        "INSERT INTO user_profiles (id, name, tone, knowledge_level, learning_goals, math_detail_level, quiz_difficulty, custom_instructions, updated_at)
         VALUES ('default', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            tone = excluded.tone,
            knowledge_level = excluded.knowledge_level,
            learning_goals = excluded.learning_goals,
            math_detail_level = excluded.math_detail_level,
            quiz_difficulty = excluded.quiz_difficulty,
            custom_instructions = excluded.custom_instructions,
            updated_at = excluded.updated_at",
        params![p.name, p.tone, p.knowledge_level, p.learning_goals, p.math_detail_level, p.quiz_difficulty, p.custom_instructions, now.to_rfc3339()],
    )?;
    Ok(())
}

// ================= LLM CONFIG =================
pub fn get_llm_config(db: &DbHandle) -> Result<LLMConfig> {
    let conn = db.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT provider, api_key, base_url, model, embedding_model, temperature, max_tokens
         FROM llm_settings WHERE id = 'default' LIMIT 1"
    )?;

    let config = stmt.query_row([], |row| {
        Ok(LLMConfig {
            provider: row.get(0)?,
            api_key: row.get(1)?,
            base_url: row.get(2)?,
            model: row.get(3)?,
            embedding_model: row.get(4)?,
            temperature: row.get(5)?,
            max_tokens: row.get(6)?,
        })
    }).optional()?;

    Ok(config.unwrap_or_default())
}

pub fn save_llm_config(db: &DbHandle, c: &LLMConfig) -> Result<()> {
    let conn = db.lock().unwrap();
    conn.execute(
        "INSERT INTO llm_settings (id, provider, api_key, base_url, model, embedding_model, temperature, max_tokens, updated_at)
         VALUES ('default', ?1, ?2, ?3, ?4, ?5, ?6, ?7, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET
            provider = excluded.provider,
            api_key = excluded.api_key,
            base_url = excluded.base_url,
            model = excluded.model,
            embedding_model = excluded.embedding_model,
            temperature = excluded.temperature,
            max_tokens = excluded.max_tokens,
            updated_at = CURRENT_TIMESTAMP",
        params![c.provider, c.api_key, c.base_url, c.model, c.embedding_model, c.temperature, c.max_tokens],
    )?;
    Ok(())
}

// ================= COURSES =================
pub fn list_courses(db: &DbHandle) -> Result<Vec<Course>> {
    let conn = db.lock().unwrap();
    let mut stmt = conn.prepare("SELECT id, title, description, category, syllabus, created_at, updated_at FROM courses ORDER BY created_at DESC")?;
    let rows = stmt.query_map([], |row| {
        let created_str: String = row.get(5)?;
        let updated_str: String = row.get(6)?;
        Ok(Course {
            id: row.get(0)?,
            title: row.get(1)?,
            description: row.get(2)?,
            category: row.get(3)?,
            syllabus: row.get(4)?,
            created_at: DateTime::parse_from_rfc3339(&created_str).map(|d| d.with_timezone(&Utc)).unwrap_or_else(|_| Utc::now()),
            updated_at: DateTime::parse_from_rfc3339(&updated_str).map(|d| d.with_timezone(&Utc)).unwrap_or_else(|_| Utc::now()),
        })
    })?;

    let mut list = Vec::new();
    for r in rows {
        list.push(r?);
    }
    Ok(list)
}

pub fn get_course(db: &DbHandle, id: &str) -> Result<Option<Course>> {
    let conn = db.lock().unwrap();
    let mut stmt = conn.prepare("SELECT id, title, description, category, syllabus, created_at, updated_at FROM courses WHERE id = ?1")?;
    let course = stmt.query_row(params![id], |row| {
        let created_str: String = row.get(5)?;
        let updated_str: String = row.get(6)?;
        Ok(Course {
            id: row.get(0)?,
            title: row.get(1)?,
            description: row.get(2)?,
            category: row.get(3)?,
            syllabus: row.get(4)?,
            created_at: DateTime::parse_from_rfc3339(&created_str).map(|d| d.with_timezone(&Utc)).unwrap_or_else(|_| Utc::now()),
            updated_at: DateTime::parse_from_rfc3339(&updated_str).map(|d| d.with_timezone(&Utc)).unwrap_or_else(|_| Utc::now()),
        })
    }).optional()?;
    Ok(course)
}

pub fn create_course(db: &DbHandle, req: &CreateCourseReq) -> Result<Course> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now();
    let desc = req.description.clone().unwrap_or_default();
    let cat = req.category.clone().unwrap_or_else(|| "General".to_string());
    let syl = req.syllabus.clone().unwrap_or_default();

    let conn = db.lock().unwrap();
    conn.execute(
        "INSERT INTO courses (id, title, description, category, syllabus, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, req.title, desc, cat, syl, now.to_rfc3339(), now.to_rfc3339()],
    )?;

    // Graph node
    conn.execute(
        "INSERT OR REPLACE INTO graph_nodes (id, label, node_type, metadata_json) VALUES (?1, ?2, 'course', '{}')",
        params![format!("course:{}", id), req.title],
    )?;

    Ok(Course {
        id,
        title: req.title.clone(),
        description: desc,
        category: cat,
        syllabus: syl,
        created_at: now,
        updated_at: now,
    })
}

pub fn update_course(db: &DbHandle, id: &str, req: &UpdateCourseReq) -> Result<Course> {
    let current = get_course(db, id)?.context("Course not found")?;
    let title = req.title.clone();
    let description = req.description.clone().unwrap_or(current.description);
    let category = req.category.clone().unwrap_or(current.category);
    let syllabus = req.syllabus.clone().unwrap_or(current.syllabus);
    let now = Utc::now();

    let conn = db.lock().unwrap();
    conn.execute(
        "UPDATE courses SET title = ?1, description = ?2, category = ?3, syllabus = ?4, updated_at = ?5 WHERE id = ?6",
        params![title, description, category, syllabus, now.to_rfc3339(), id],
    )?;

    conn.execute(
        "INSERT OR REPLACE INTO graph_nodes (id, label, node_type, metadata_json) VALUES (?1, ?2, 'course', '{}')",
        params![format!("course:{}", id), title],
    )?;

    Ok(Course {
        id: id.to_string(),
        title,
        description,
        category,
        syllabus,
        created_at: current.created_at,
        updated_at: now,
    })
}

pub fn delete_course(db: &DbHandle, id: &str) -> Result<()> {
    let conn = db.lock().unwrap();
    conn.execute("DELETE FROM courses WHERE id = ?1", params![id])?;
    conn.execute("DELETE FROM graph_nodes WHERE id = ?1", params![format!("course:{}", id)])?;
    Ok(())
}

// ================= TOPICS =================
pub fn list_topics(db: &DbHandle, course_id: &str) -> Result<Vec<Topic>> {
    let conn = db.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT id, course_id, chapter, title, order_index, mastery_level, quiz_score, quizzes_taken, last_quiz_date, summary, created_at
         FROM topics WHERE course_id = ?1 ORDER BY order_index ASC, created_at ASC"
    )?;

    let rows = stmt.query_map(params![course_id], |row| {
        let last_quiz_str: Option<String> = row.get(8)?;
        let created_str: String = row.get(10)?;
        Ok(Topic {
            id: row.get(0)?,
            course_id: row.get(1)?,
            chapter: row.get(2)?,
            title: row.get(3)?,
            order_index: row.get(4)?,
            mastery_level: row.get(5)?,
            quiz_score: row.get(6)?,
            quizzes_taken: row.get(7)?,
            last_quiz_date: last_quiz_str.and_then(|s| DateTime::parse_from_rfc3339(&s).ok().map(|d| d.with_timezone(&Utc))),
            summary: row.get(9)?,
            created_at: DateTime::parse_from_rfc3339(&created_str).map(|d| d.with_timezone(&Utc)).unwrap_or_else(|_| Utc::now()),
        })
    })?;

    let mut list = Vec::new();
    for r in rows {
        list.push(r?);
    }
    Ok(list)
}

pub fn get_topic(db: &DbHandle, id: &str) -> Result<Option<Topic>> {
    let conn = db.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT id, course_id, chapter, title, order_index, mastery_level, quiz_score, quizzes_taken, last_quiz_date, summary, created_at
         FROM topics WHERE id = ?1"
    )?;

    let topic = stmt.query_row(params![id], |row| {
        let last_quiz_str: Option<String> = row.get(8)?;
        let created_str: String = row.get(10)?;
        Ok(Topic {
            id: row.get(0)?,
            course_id: row.get(1)?,
            chapter: row.get(2)?,
            title: row.get(3)?,
            order_index: row.get(4)?,
            mastery_level: row.get(5)?,
            quiz_score: row.get(6)?,
            quizzes_taken: row.get(7)?,
            last_quiz_date: last_quiz_str.and_then(|s| DateTime::parse_from_rfc3339(&s).ok().map(|d| d.with_timezone(&Utc))),
            summary: row.get(9)?,
            created_at: DateTime::parse_from_rfc3339(&created_str).map(|d| d.with_timezone(&Utc)).unwrap_or_else(|_| Utc::now()),
        })
    }).optional()?;

    Ok(topic)
}

pub fn create_topic(db: &DbHandle, req: &CreateTopicReq) -> Result<Topic> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now();
    let chapter = req.chapter.clone().unwrap_or_else(|| "Module".to_string());
    let mastery = req.mastery_level.clone().unwrap_or_else(|| "to_learn".to_string());
    let summary = req.summary.clone().unwrap_or_default();
    let order_idx = req.order_index.unwrap_or(0);

    let conn = db.lock().unwrap();
    conn.execute(
        "INSERT INTO topics (id, course_id, chapter, title, order_index, mastery_level, summary, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![id, req.course_id, chapter, req.title, order_idx, mastery, summary, now.to_rfc3339()],
    )?;

    // Graph node & edge
    conn.execute(
        "INSERT OR REPLACE INTO graph_nodes (id, label, node_type, metadata_json) VALUES (?1, ?2, 'topic', '{}')",
        params![format!("topic:{}", id), req.title],
    )?;
    conn.execute(
        "INSERT OR REPLACE INTO graph_edges (source_id, target_id, relation, weight) VALUES (?1, ?2, 'contains', 1.0)",
        params![format!("course:{}", req.course_id), format!("topic:{}", id)],
    )?;

    Ok(Topic {
        id,
        course_id: req.course_id.clone(),
        chapter,
        title: req.title.clone(),
        order_index: order_idx,
        mastery_level: mastery,
        quiz_score: None,
        quizzes_taken: Some(0),
        last_quiz_date: None,
        summary,
        created_at: now,
    })
}

pub fn update_topic(db: &DbHandle, id: &str, req: &UpdateTopicReq) -> Result<Topic> {
    let mut topic = get_topic(db, id)?.context("Topic not found")?;

    if let Some(ref ch) = req.chapter { topic.chapter = ch.clone(); }
    topic.title = req.title.clone();
    if let Some(ref m) = req.mastery_level { topic.mastery_level = m.clone(); }
    if let Some(s) = req.quiz_score { topic.quiz_score = Some(s); }
    if let Some(c) = req.quizzes_taken { topic.quizzes_taken = Some(c); }
    if let Some(ref sum) = req.summary { topic.summary = sum.clone(); }

    let conn = db.lock().unwrap();
    conn.execute(
        "UPDATE topics SET chapter = ?1, title = ?2, order_index = ?3, mastery_level = ?4, quiz_score = ?5, quizzes_taken = ?6, summary = ?7 WHERE id = ?8",
        params![topic.chapter, topic.title, topic.order_index, topic.mastery_level, topic.quiz_score, topic.quizzes_taken, topic.summary, id],
    )?;

    conn.execute(
        "INSERT OR REPLACE INTO graph_nodes (id, label, node_type, metadata_json) VALUES (?1, ?2, 'topic', '{}')",
        params![format!("topic:{}", id), topic.title],
    )?;

    Ok(topic)
}

pub fn record_topic_quiz_score(db: &DbHandle, id: &str, score: f32) -> Result<Topic> {
    let mut topic = get_topic(db, id)?.context("Topic not found")?;
    let prev_count = topic.quizzes_taken.unwrap_or(0);
    let prev_score = topic.quiz_score.unwrap_or(score);
    let new_count = prev_count + 1;
    let new_score = (prev_score * prev_count as f32 + score) / (new_count as f32);

    topic.mastery_level = if new_score >= 80.0 {
        "mastered".to_string()
    } else if new_score >= 50.0 {
        "in_progress".to_string()
    } else {
        "review_needed".to_string()
    };

    topic.quizzes_taken = Some(new_count);
    topic.quiz_score = Some((new_score * 10.0).round() / 10.0);
    let now = Utc::now();
    topic.last_quiz_date = Some(now);

    let conn = db.lock().unwrap();
    conn.execute(
        "UPDATE topics SET mastery_level = ?1, quiz_score = ?2, quizzes_taken = ?3, last_quiz_date = ?4 WHERE id = ?5",
        params![topic.mastery_level, topic.quiz_score, topic.quizzes_taken, now.to_rfc3339(), id],
    )?;

    Ok(topic)
}

pub fn delete_topic(db: &DbHandle, id: &str) -> Result<()> {
    let conn = db.lock().unwrap();
    conn.execute("DELETE FROM topics WHERE id = ?1", params![id])?;
    conn.execute("DELETE FROM graph_nodes WHERE id = ?1", params![format!("topic:{}", id)])?;
    Ok(())
}

// ================= STATS OVERVIEW =================
pub fn get_overview_stats(db: &DbHandle) -> Result<OverviewStats> {
    let conn = db.lock().unwrap();

    let total_courses: i64 = conn.query_row("SELECT COUNT(*) FROM courses", [], |r| r.get(0))?;
    let total_topics: i64 = conn.query_row("SELECT COUNT(*) FROM topics", [], |r| r.get(0))?;
    let mastered_topics: i64 = conn.query_row("SELECT COUNT(*) FROM topics WHERE mastery_level = 'mastered'", [], |r| r.get(0))?;
    let total_quizzes: i64 = conn.query_row("SELECT COALESCE(SUM(quizzes_taken), 0) FROM topics", [], |r| r.get(0))?;
    let avg_quiz_score: f32 = conn.query_row("SELECT COALESCE(AVG(quiz_score), 0.0) FROM topics WHERE quiz_score IS NOT NULL", [], |r| r.get(0))?;
    let total_notes: i64 = conn.query_row("SELECT COUNT(*) FROM notes", [], |r| r.get(0))?;
    let bookmarked_notes: i64 = conn.query_row("SELECT COUNT(*) FROM notes WHERE is_bookmarked = 1", [], |r| r.get(0))?;

    Ok(OverviewStats {
        total_courses: total_courses as usize,
        total_topics: total_topics as usize,
        total_quizzes_taken: total_quizzes as u32,
        avg_quiz_score: (avg_quiz_score * 10.0).round() / 10.0,
        mastered_topics: mastered_topics as usize,
        total_notes: total_notes as usize,
        bookmarked_notes: bookmarked_notes as usize,
    })
}

// ================= DOCUMENTS & VECTOR SEARCH =================
pub fn list_documents(db: &DbHandle, course_id: &str) -> Result<Vec<CourseDocument>> {
    let conn = db.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT id, course_id, topic_id, title, doc_type, content, embedding_blob, created_at
         FROM documents WHERE course_id = ?1 ORDER BY created_at DESC"
    )?;

    let rows = stmt.query_map(params![course_id], |row| {
        let blob_opt: Option<Vec<u8>> = row.get(6)?;
        let emb = blob_opt.map(|b| blob_to_vector(&b));
        let created_str: String = row.get(7)?;
        Ok(CourseDocument {
            id: row.get(0)?,
            course_id: row.get(1)?,
            topic_id: row.get(2)?,
            title: row.get(3)?,
            doc_type: row.get(4)?,
            content: row.get(5)?,
            embedding: emb,
            created_at: DateTime::parse_from_rfc3339(&created_str).map(|d| d.with_timezone(&Utc)).unwrap_or_else(|_| Utc::now()),
        })
    })?;

    let mut list = Vec::new();
    for r in rows {
        list.push(r?);
    }
    Ok(list)
}

pub fn get_document(db: &DbHandle, id: &str) -> Result<Option<CourseDocument>> {
    let conn = db.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT id, course_id, topic_id, title, doc_type, content, embedding_blob, created_at
         FROM documents WHERE id = ?1"
    )?;

    let doc = stmt.query_row(params![id], |row| {
        let blob_opt: Option<Vec<u8>> = row.get(6)?;
        let emb = blob_opt.map(|b| blob_to_vector(&b));
        let created_str: String = row.get(7)?;
        Ok(CourseDocument {
            id: row.get(0)?,
            course_id: row.get(1)?,
            topic_id: row.get(2)?,
            title: row.get(3)?,
            doc_type: row.get(4)?,
            content: row.get(5)?,
            embedding: emb,
            created_at: DateTime::parse_from_rfc3339(&created_str).map(|d| d.with_timezone(&Utc)).unwrap_or_else(|_| Utc::now()),
        })
    }).optional()?;

    Ok(doc)
}

pub fn create_document(db: &DbHandle, req: &CreateDocumentReq) -> Result<CourseDocument> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now();
    let conn = db.lock().unwrap();

    conn.execute(
        "INSERT INTO documents (id, course_id, topic_id, title, doc_type, content, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, req.course_id, req.topic_id, req.title, req.doc_type, req.content, now.to_rfc3339()],
    )?;

    Ok(CourseDocument {
        id,
        course_id: req.course_id.clone(),
        topic_id: req.topic_id.clone(),
        title: req.title.clone(),
        doc_type: req.doc_type.clone(),
        content: req.content.clone(),
        embedding: None,
        created_at: now,
    })
}

pub fn update_doc_embedding(db: &DbHandle, id: &str, embedding: &[f32]) -> Result<()> {
    let blob = vector_to_blob(embedding);
    let dims = embedding.len() as i64;
    let conn = db.lock().unwrap();
    conn.execute(
        "UPDATE documents SET embedding_blob = ?1, dimensions = ?2 WHERE id = ?3",
        params![blob, dims, id],
    )?;
    Ok(())
}

pub fn delete_document(db: &DbHandle, id: &str) -> Result<()> {
    let conn = db.lock().unwrap();
    conn.execute("DELETE FROM documents WHERE id = ?1", params![id])?;
    Ok(())
}

/// Search documents semantically using vector similarity in SQLite
pub fn search_documents_vector(db: &DbHandle, course_id: Option<&str>, query_embedding: &[f32], limit: usize) -> Result<Vec<(CourseDocument, f32)>> {
    let conn = db.lock().unwrap();
    let mut stmt = if let Some(_) = course_id {
        conn.prepare("SELECT id, course_id, topic_id, title, doc_type, content, embedding_blob, created_at FROM documents WHERE course_id = ?1 AND embedding_blob IS NOT NULL")?
    } else {
        conn.prepare("SELECT id, course_id, topic_id, title, doc_type, content, embedding_blob, created_at FROM documents WHERE embedding_blob IS NOT NULL")?
    };

    let mapper = |row: &rusqlite::Row| {
        let blob: Vec<u8> = row.get(6)?;
        let emb = blob_to_vector(&blob);
        let created_str: String = row.get(7)?;
        let doc = CourseDocument {
            id: row.get(0)?,
            course_id: row.get(1)?,
            topic_id: row.get(2)?,
            title: row.get(3)?,
            doc_type: row.get(4)?,
            content: row.get(5)?,
            embedding: Some(emb.clone()),
            created_at: DateTime::parse_from_rfc3339(&created_str).map(|d| d.with_timezone(&Utc)).unwrap_or_else(|_| Utc::now()),
        };
        let sim = cosine_similarity(query_embedding, &emb);
        Ok((doc, sim))
    };

    let mut results: Vec<(CourseDocument, f32)> = if let Some(cid) = course_id {
        stmt.query_map(params![cid], mapper)?.filter_map(|r| r.ok()).collect()
    } else {
        stmt.query_map([], mapper)?.filter_map(|r| r.ok()).collect()
    };

    results.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    results.truncate(limit);
    Ok(results)
}

// ================= NOTES =================
pub fn list_notes(
    db: &DbHandle,
    course_id: Option<&str>,
    topic_id: Option<&str>,
    bookmarked_only: bool,
    tag: Option<&str>,
) -> Result<Vec<Note>> {
    let conn = db.lock().unwrap();
    let mut sql = "SELECT id, course_id, topic_id, title, content, tags_json, is_bookmarked, embedding_blob, created_at, updated_at FROM notes WHERE 1=1".to_string();
    let mut params_vec: Vec<rusqlite::types::Value> = Vec::new();

    if let Some(cid) = course_id {
        sql.push_str(" AND course_id = ?");
        params_vec.push(cid.to_string().into());
    }
    if let Some(tid) = topic_id {
        sql.push_str(" AND topic_id = ?");
        params_vec.push(tid.to_string().into());
    }
    if bookmarked_only {
        sql.push_str(" AND is_bookmarked = 1");
    }

    sql.push_str(" ORDER BY updated_at DESC");

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(params_vec), |row| {
        let tags_str: String = row.get(5)?;
        let tags: Vec<String> = serde_json::from_str(&tags_str).unwrap_or_default();
        let blob_opt: Option<Vec<u8>> = row.get(7)?;
        let emb = blob_opt.map(|b| blob_to_vector(&b));
        let created_str: String = row.get(8)?;
        let updated_str: String = row.get(9)?;

        Ok(Note {
            id: row.get(0)?,
            course_id: row.get(1)?,
            topic_id: row.get(2)?,
            title: row.get(3)?,
            content: row.get(4)?,
            tags,
            is_bookmarked: row.get(6)?,
            embedding: emb,
            created_at: DateTime::parse_from_rfc3339(&created_str).map(|d| d.with_timezone(&Utc)).unwrap_or_else(|_| Utc::now()),
            updated_at: DateTime::parse_from_rfc3339(&updated_str).map(|d| d.with_timezone(&Utc)).unwrap_or_else(|_| Utc::now()),
        })
    })?;

    let mut list = Vec::new();
    for r in rows {
        let note = r?;
        if let Some(t) = tag {
            if !note.tags.iter().any(|item| item.eq_ignore_ascii_case(t)) {
                continue;
            }
        }
        list.push(note);
    }
    Ok(list)
}

pub fn get_note(db: &DbHandle, id: &str) -> Result<Option<Note>> {
    let conn = db.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT id, course_id, topic_id, title, content, tags_json, is_bookmarked, embedding_blob, created_at, updated_at
         FROM notes WHERE id = ?1"
    )?;

    let note = stmt.query_row(params![id], |row| {
        let tags_str: String = row.get(5)?;
        let tags: Vec<String> = serde_json::from_str(&tags_str).unwrap_or_default();
        let blob_opt: Option<Vec<u8>> = row.get(7)?;
        let emb = blob_opt.map(|b| blob_to_vector(&b));
        let created_str: String = row.get(8)?;
        let updated_str: String = row.get(9)?;

        Ok(Note {
            id: row.get(0)?,
            course_id: row.get(1)?,
            topic_id: row.get(2)?,
            title: row.get(3)?,
            content: row.get(4)?,
            tags,
            is_bookmarked: row.get(6)?,
            embedding: emb,
            created_at: DateTime::parse_from_rfc3339(&created_str).map(|d| d.with_timezone(&Utc)).unwrap_or_else(|_| Utc::now()),
            updated_at: DateTime::parse_from_rfc3339(&updated_str).map(|d| d.with_timezone(&Utc)).unwrap_or_else(|_| Utc::now()),
        })
    }).optional()?;

    Ok(note)
}

pub fn create_note(db: &DbHandle, req: &CreateNoteReq) -> Result<Note> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now();
    let tags = req.tags.clone().unwrap_or_default();
    let tags_json = serde_json::to_string(&tags)?;

    let conn = db.lock().unwrap();
    conn.execute(
        "INSERT INTO notes (id, course_id, topic_id, title, content, tags_json, is_bookmarked, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?8)",
        params![id, req.course_id, req.topic_id, req.title, req.content, tags_json, now.to_rfc3339(), now.to_rfc3339()],
    )?;

    // Sync into Graph DB
    sync_note_graph_nodes(&conn, &id, &req.title, &req.content, req.course_id.as_deref(), req.topic_id.as_deref())?;

    Ok(Note {
        id,
        course_id: req.course_id.clone(),
        topic_id: req.topic_id.clone(),
        title: req.title.clone(),
        content: req.content.clone(),
        tags,
        is_bookmarked: false,
        embedding: None,
        created_at: now,
        updated_at: now,
    })
}

pub fn update_note(db: &DbHandle, id: &str, req: &UpdateNoteReq) -> Result<Note> {
    let current = get_note(db, id)?.context("Note not found")?;
    let title = req.title.clone();
    let content = req.content.clone();
    let tags = req.tags.clone().unwrap_or(current.tags);
    let tags_json = serde_json::to_string(&tags)?;
    let now = Utc::now();

    let conn = db.lock().unwrap();
    conn.execute(
        "UPDATE notes SET title = ?1, content = ?2, tags_json = ?3, updated_at = ?4 WHERE id = ?5",
        params![title, content, tags_json, now.to_rfc3339(), id],
    )?;

    sync_note_graph_nodes(&conn, id, &title, &content, current.course_id.as_deref(), current.topic_id.as_deref())?;

    Ok(Note {
        id: id.to_string(),
        course_id: current.course_id,
        topic_id: current.topic_id,
        title,
        content,
        tags,
        is_bookmarked: req.is_bookmarked.unwrap_or(current.is_bookmarked),
        embedding: current.embedding,
        created_at: current.created_at,
        updated_at: now,
    })
}

pub fn update_note_embedding(db: &DbHandle, id: &str, embedding: &[f32]) -> Result<()> {
    let blob = vector_to_blob(embedding);
    let conn = db.lock().unwrap();
    conn.execute(
        "UPDATE notes SET embedding_blob = ?1 WHERE id = ?2",
        params![blob, id],
    )?;
    Ok(())
}

pub fn toggle_bookmark_note(db: &DbHandle, id: &str) -> Result<bool> {
    let current = get_note(db, id)?.context("Note not found")?;
    let new_val = !current.is_bookmarked;
    let conn = db.lock().unwrap();
    conn.execute("UPDATE notes SET is_bookmarked = ?1 WHERE id = ?2", params![new_val, id])?;
    Ok(new_val)
}

pub fn delete_note(db: &DbHandle, id: &str) -> Result<()> {
    let conn = db.lock().unwrap();
    conn.execute("DELETE FROM notes WHERE id = ?1", params![id])?;
    conn.execute("DELETE FROM graph_nodes WHERE id = ?1", params![id])?;
    Ok(())
}

// ================= KNOWLEDGE GRAPH (SQLite) =================
pub fn sync_note_graph_nodes(conn: &Connection, note_id: &str, title: &str, content: &str, course_id: Option<&str>, topic_id: Option<&str>) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO graph_nodes (id, label, node_type, metadata_json) VALUES (?1, ?2, 'note', '{}')",
        params![note_id, title],
    )?;

    if let Some(cid) = course_id {
        conn.execute(
            "INSERT OR REPLACE INTO graph_edges (source_id, target_id, relation, weight) VALUES (?1, ?2, 'contains', 1.0)",
            params![format!("course:{}", cid), note_id],
        )?;
    }
    if let Some(tid) = topic_id {
        conn.execute(
            "INSERT OR REPLACE INTO graph_edges (source_id, target_id, relation, weight) VALUES (?1, ?2, 'contains', 1.0)",
            params![format!("topic:{}", tid), note_id],
        )?;
    }

    // Extract [[Wikilinks]]
    let mut start_idx = 0;
    while let Some(start) = content[start_idx..].find("[[") {
        let actual_start = start_idx + start + 2;
        if let Some(end) = content[actual_start..].find("]]") {
            let concept = content[actual_start..actual_start + end].trim();
            if !concept.is_empty() {
                let concept_id = format!("concept:{}", concept.to_lowercase().replace(' ', "_"));
                let _ = conn.execute(
                    "INSERT OR REPLACE INTO graph_nodes (id, label, node_type, metadata_json) VALUES (?1, ?2, 'concept', '{}')",
                    params![concept_id, concept],
                );
                let _ = conn.execute(
                    "INSERT OR REPLACE INTO graph_edges (source_id, target_id, relation, weight) VALUES (?1, ?2, 'wikilink', 1.0)",
                    params![note_id, concept_id],
                );
            }
            start_idx = actual_start + end + 2;
        } else {
            break;
        }
    }
    Ok(())
}

pub fn get_entire_graph(db: &DbHandle) -> Result<GraphDataResponse> {
    let conn = db.lock().unwrap();
    let mut node_stmt = conn.prepare("SELECT id, label, node_type, metadata_json FROM graph_nodes")?;
    let node_rows = node_stmt.query_map([], |row| {
        Ok(GraphNode {
            id: row.get(0)?,
            label: row.get(1)?,
            node_type: row.get(2)?,
            metadata_json: row.get(3)?,
        })
    })?;

    let mut nodes = Vec::new();
    for n in node_rows {
        nodes.push(n?);
    }

    let mut edge_stmt = conn.prepare("SELECT source_id, target_id, relation, weight FROM graph_edges")?;
    let edge_rows = edge_stmt.query_map([], |row| {
        Ok(GraphEdge {
            source_id: row.get(0)?,
            target_id: row.get(1)?,
            relation: row.get(2)?,
            weight: row.get(3)?,
        })
    })?;

    let mut edges = Vec::new();
    for e in edge_rows {
        edges.push(e?);
    }

    Ok(GraphDataResponse { nodes, edges })
}

// ================= CHAT HISTORY =================
pub fn save_chat_message(db: &DbHandle, course_id: Option<&str>, topic_id: Option<&str>, role: &str, content: &str) -> Result<()> {
    let id = Uuid::new_v4().to_string();
    let conn = db.lock().unwrap();
    conn.execute(
        "INSERT INTO chat_history (id, course_id, topic_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, course_id, topic_id, role, content, Utc::now().to_rfc3339()],
    )?;
    Ok(())
}

pub fn get_chat_history(db: &DbHandle, course_id: Option<&str>, topic_id: Option<&str>, limit: usize) -> Result<Vec<ChatMessage>> {
    let conn = db.lock().unwrap();
    let mut sql = "SELECT id, course_id, topic_id, role, content, created_at FROM chat_history WHERE 1=1".to_string();
    let mut params_vec: Vec<rusqlite::types::Value> = Vec::new();

    if let Some(cid) = course_id {
        sql.push_str(" AND course_id = ?");
        params_vec.push(cid.to_string().into());
    }
    if let Some(tid) = topic_id {
        sql.push_str(" AND topic_id = ?");
        params_vec.push(tid.to_string().into());
    }
    sql.push_str(" ORDER BY created_at DESC LIMIT ?");
    params_vec.push((limit as i64).into());

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(params_vec), |row| {
        let created_str: String = row.get(5)?;
        Ok(ChatMessage {
            id: row.get(0)?,
            course_id: row.get(1)?,
            topic_id: row.get(2)?,
            role: row.get(3)?,
            content: row.get(4)?,
            created_at: DateTime::parse_from_rfc3339(&created_str).map(|d| d.with_timezone(&Utc)).unwrap_or_else(|_| Utc::now()),
        })
    })?;

    let mut list = Vec::new();
    for r in rows {
        list.push(r?);
    }
    list.reverse();
    Ok(list)
}

pub fn clear_chat_history(db: &DbHandle, course_id: Option<&str>, topic_id: Option<&str>) -> Result<()> {
    let conn = db.lock().unwrap();
    if let Some(cid) = course_id {
        conn.execute("DELETE FROM chat_history WHERE course_id = ?1", params![cid])?;
    } else if let Some(tid) = topic_id {
        conn.execute("DELETE FROM chat_history WHERE topic_id = ?1", params![tid])?;
    } else {
        conn.execute("DELETE FROM chat_history", [])?;
    }
    Ok(())
}

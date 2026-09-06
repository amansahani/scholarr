use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserProfile {
    pub id: String,
    pub name: String,
    pub tone: String, // "socratic", "eli5", "rigorous", "concise", "exam_prep"
    pub knowledge_level: String, // "beginner", "intermediate", "advanced", "expert"
    pub learning_goals: String,
    pub math_detail_level: String, // "high", "standard", "intuitive"
    #[serde(default = "default_quiz_difficulty")]
    pub quiz_difficulty: String, // "adaptive", "fundamentals", "intermediate", "advanced", "olympiad"
    pub custom_instructions: String,
    pub updated_at: DateTime<Utc>,
}

fn default_quiz_difficulty() -> String {
    "adaptive".to_string()
}

impl Default for UserProfile {
    fn default() -> Self {
        Self {
            id: "default".to_string(),
            name: "Student".to_string(),
            tone: "socratic".to_string(),
            knowledge_level: "intermediate".to_string(),
            learning_goals: "Master theoretical foundations and practical applications with clear intuition and mathematical rigor.".to_string(),
            math_detail_level: "high".to_string(),
            quiz_difficulty: "adaptive".to_string(),
            custom_instructions: "Use LaTeX for all mathematical notations, step-by-step reasoning, and test my understanding with occasional conceptual questions.".to_string(),
            updated_at: Utc::now(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LLMConfig {
    pub provider: String, // "openrouter", "gemini", "openai", "groq", "ollama", "anthropic", "custom"
    pub api_key: String,
    pub base_url: String,
    pub model: String,
    pub embedding_model: String,
    pub temperature: f32,
    pub max_tokens: u32,
}

impl Default for LLMConfig {
    fn default() -> Self {
        Self {
            provider: std::env::var("LLM_PROVIDER").unwrap_or_else(|_| "openrouter".to_string()),
            api_key: std::env::var("LLM_API_KEY").unwrap_or_default(),
            base_url: std::env::var("LLM_BASE_URL").unwrap_or_else(|_| "https://openrouter.ai/api/v1".to_string()),
            model: std::env::var("LLM_MODEL").unwrap_or_else(|_| "poolside/laguna-s-2.1:free".to_string()),
            embedding_model: std::env::var("LLM_EMBEDDING_MODEL").unwrap_or_else(|_| "liquid/lfm-2.5-embedding-350m:free".to_string()),
            temperature: 0.7,
            max_tokens: 4096,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Course {
    pub id: String,
    pub title: String,
    pub description: String,
    pub category: String,
    pub syllabus: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Topic {
    pub id: String,
    pub course_id: String,
    #[serde(default)]
    pub chapter: String, // e.g. "Chapter 1: Foundations", "Chapter 2: LTI Systems"
    pub title: String,
    pub order_index: i32,
    pub mastery_level: String, // "to_learn", "in_progress", "mastered", "review_needed"
    #[serde(default)]
    pub quiz_score: Option<f32>, // 0.0 - 100.0
    #[serde(default)]
    pub quizzes_taken: Option<u32>,
    #[serde(default)]
    pub last_quiz_date: Option<DateTime<Utc>>,
    pub summary: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CourseDocument {
    pub id: String,
    pub course_id: String,
    pub topic_id: Option<String>,
    pub title: String,
    pub doc_type: String, // "syllabus", "book_chapter", "paper", "lecture_notes"
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embedding: Option<Vec<f32>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub id: String,
    pub course_id: Option<String>,
    pub topic_id: Option<String>,
    pub title: String,
    pub content: String,
    pub tags: Vec<String>,
    pub is_bookmarked: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embedding: Option<Vec<f32>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: String,
    pub course_id: Option<String>,
    pub topic_id: Option<String>,
    pub role: String, // "user", "assistant", "system"
    pub content: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserMemory {
    pub id: String,
    pub memory_type: String, // "preference", "fact", "misconception", "goal", "weakness"
    pub key: String,
    pub value: String,
    pub confidence: f32,
    pub source_event: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embedding: Option<Vec<f32>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateMemoryReq {
    pub memory_type: String,
    pub key: String,
    pub value: String,
    pub confidence: Option<f32>,
    pub source_event: Option<String>,
}

// Request / Response Payloads
#[derive(Debug, Deserialize)]
pub struct CreateCourseReq {
    pub title: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub syllabus: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateCourseReq {
    pub title: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub syllabus: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateTopicReq {
    pub course_id: String,
    pub chapter: Option<String>,
    pub title: String,
    pub order_index: Option<i32>,
    pub mastery_level: Option<String>,
    pub quiz_score: Option<f32>,
    pub quizzes_taken: Option<u32>,
    pub summary: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateTopicReq {
    pub chapter: Option<String>,
    pub title: String,
    pub mastery_level: Option<String>,
    pub quiz_score: Option<f32>,
    pub quizzes_taken: Option<u32>,
    pub summary: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RecordQuizScoreReq {
    pub score: f32,
    pub mastery_level: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct GenerateQuizReq {
    pub course_id: Option<String>,
    pub topic_id: Option<String>,
    pub difficulty: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuizQuestion {
    pub id: usize,
    pub question: String,
    pub options: Vec<String>,
    pub hint: Option<String>,
    pub correct_option: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GeneratedQuizResponse {
    pub course_id: Option<String>,
    pub topic_id: Option<String>,
    pub topic_title: String,
    pub difficulty: String,
    pub questions: Vec<QuizQuestion>,
}

#[derive(Debug, Deserialize)]
pub struct SubmitQuizAnswer {
    pub question_id: usize,
    pub question: String,
    pub user_answer: String,
    pub correct_option: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SubmitQuizReq {
    pub course_id: Option<String>,
    pub topic_id: Option<String>,
    pub difficulty: Option<String>,
    pub answers: Vec<SubmitQuizAnswer>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QuizFeedbackItem {
    pub question_id: usize,
    pub question: String,
    pub user_answer: String,
    pub correct_answer: String,
    pub is_correct: bool,
    pub explanation: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SubmitQuizResponse {
    pub score_percentage: f32,
    pub total_questions: usize,
    pub correct_count: usize,
    pub mastery_level: String,
    pub topic_id: Option<String>,
    pub topic_title: Option<String>,
    pub difficulty: String,
    pub feedback: Vec<QuizFeedbackItem>,
    pub overall_critique: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OverviewStats {
    pub total_courses: usize,
    pub total_topics: usize,
    pub total_quizzes_taken: u32,
    pub avg_quiz_score: f32,
    pub mastered_topics: usize,
    pub total_notes: usize,
    pub bookmarked_notes: usize,
}

#[derive(Debug, Deserialize)]
pub struct CreateDocumentReq {
    pub course_id: String,
    pub topic_id: Option<String>,
    pub title: String,
    pub doc_type: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateNoteReq {
    pub course_id: Option<String>,
    pub topic_id: Option<String>,
    pub title: String,
    pub content: String,
    pub tags: Option<Vec<String>>,
    pub is_bookmarked: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateNoteReq {
    pub title: String,
    pub content: String,
    pub course_id: Option<String>,
    pub topic_id: Option<String>,
    pub tags: Option<Vec<String>>,
    pub is_bookmarked: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct ChatRequest {
    pub message: String,
    pub course_id: Option<String>,
    pub topic_id: Option<String>,
    pub include_syllabus: Option<bool>,
    pub include_notes: Option<bool>,
    pub include_docs: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroundedSource {
    pub id: String,
    pub title: String,
    pub source_type: String, // "doc", "note", "syllabus"
    pub excerpt: String,
    pub similarity: Option<f32>,
}

#[derive(Debug, Serialize)]
pub struct ChatResponse {
    pub reply: String,
    pub sources_used: Vec<String>,
    pub source_items: Vec<GroundedSource>,
    pub suggested_note: Option<SuggestedNote>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SuggestedNote {
    pub title: String,
    pub content: String,
    pub tags: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct GenerateNoteReq {
    pub prompt: String,
    pub course_id: Option<String>,
    pub topic_id: Option<String>,
    pub source_text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphNode {
    pub id: String,
    pub label: String,
    pub node_type: String, // "course", "topic", "note", "concept"
    pub metadata_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphEdge {
    pub source_id: String,
    pub target_id: String,
    pub relation: String, // "contains", "references", "prerequisite", "wikilink"
    pub weight: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphDataResponse {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

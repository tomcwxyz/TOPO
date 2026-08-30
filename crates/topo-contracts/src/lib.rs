use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

pub const DOMAIN_CONTRACT_VERSION: &str = "0.1";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EpistemicType {
    Assertion,
    Observation,
    Inference,
    Preference,
    DerivedPattern,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ClaimStatus {
    Candidate,
    Confirmed,
    Rejected,
    Superseded,
    Expired,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Sensitivity {
    Ordinary,
    Personal,
    Sensitive,
    Restricted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SourceType {
    Conversation,
    Document,
    Manual,
    Mcp,
    Import,
    Connector,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ActorType {
    User,
    Agent,
    System,
    Import,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EventEntityType {
    Claim,
    Source,
    Document,
    Schema,
    Context,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum EventType {
    #[serde(rename = "source.captured")]
    SourceCaptured,
    #[serde(rename = "claim.proposed")]
    ClaimProposed,
    #[serde(rename = "claim.confirmed")]
    ClaimConfirmed,
    #[serde(rename = "claim.edited")]
    ClaimEdited,
    #[serde(rename = "claim.rejected")]
    ClaimRejected,
    #[serde(rename = "claim.superseded")]
    ClaimSuperseded,
    #[serde(rename = "claim.expired")]
    ClaimExpired,
    #[serde(rename = "document.generated")]
    DocumentGenerated,
    #[serde(rename = "document.accepted")]
    DocumentAccepted,
    #[serde(rename = "context.resolved")]
    ContextResolved,
    #[serde(rename = "context.shared")]
    ContextShared,
    #[serde(rename = "schema.updated")]
    SchemaUpdated,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Actor {
    #[serde(rename = "type")]
    pub actor_type: ActorType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimProvenance {
    pub source_type: SourceType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence: Option<String>,
    pub captured_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryClaim {
    pub id: String,
    pub subject: String,
    pub key: String,
    pub value: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    pub tags: Vec<String>,
    pub epistemic_type: EpistemicType,
    pub confidence: f64,
    pub provenance: ClaimProvenance,
    pub status: ClaimStatus,
    pub sensitivity: Sensitivity,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub valid_from: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub valid_until: Option<String>,
    pub supersedes: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySource {
    pub id: String,
    #[serde(rename = "type")]
    pub source_type: SourceType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub external_id: Option<String>,
    pub captured_at: String,
    pub created_at: String,
    pub sensitivity: Sensitivity,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<BTreeMap<String, Value>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryEvent {
    pub id: String,
    #[serde(rename = "type")]
    pub event_type: EventType,
    pub entity_type: EventEntityType,
    pub entity_id: String,
    pub occurred_at: String,
    pub actor: Actor,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<BTreeMap<String, Value>>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, path::PathBuf};

    fn fixture(name: &str) -> Value {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../test-fixtures/domain")
            .join(name);
        let content = fs::read_to_string(path).expect("fixture should be readable");
        serde_json::from_str(&content).expect("fixture should be valid JSON")
    }

    #[test]
    fn source_fixture_round_trips() {
        let original = fixture("source-conversation.json");
        let parsed: MemorySource =
            serde_json::from_value(original.clone()).expect("source fixture should parse");
        assert_eq!(serde_json::to_value(parsed).unwrap(), original);
    }

    #[test]
    fn preference_claim_fixture_round_trips() {
        let original = fixture("claim-preference.json");
        let parsed: MemoryClaim =
            serde_json::from_value(original.clone()).expect("claim fixture should parse");
        assert_eq!(parsed.epistemic_type, EpistemicType::Preference);
        assert_eq!(serde_json::to_value(parsed).unwrap(), original);
    }

    #[test]
    fn inference_remains_explicit_and_candidate() {
        let original = fixture("claim-inference.json");
        let parsed: MemoryClaim =
            serde_json::from_value(original.clone()).expect("claim fixture should parse");
        assert_eq!(parsed.epistemic_type, EpistemicType::Inference);
        assert_eq!(parsed.status, ClaimStatus::Candidate);
        assert_eq!(serde_json::to_value(parsed).unwrap(), original);
    }

    #[test]
    fn event_fixture_round_trips() {
        let original = fixture("event-confirmed.json");
        let parsed: MemoryEvent =
            serde_json::from_value(original.clone()).expect("event fixture should parse");
        assert_eq!(serde_json::to_value(parsed).unwrap(), original);
    }
}

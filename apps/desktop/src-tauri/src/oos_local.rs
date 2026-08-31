use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::Duration,
};
use tiny_http::{Header, Method, Response, Server, StatusCode};
use topo_contracts::{
    Actor, ActorType, ClaimProvenance, ClaimStatus, EpistemicType, EventEntityType, EventType,
    MemoryClaim, MemoryEvent, MemorySource, Sensitivity, SourceType,
};
use uuid::Uuid;

const PROTOCOL: &str = "oos-local/0.1";
const MAX_BODY_BYTES: usize = 128 * 1024;
const MAX_PROPOSALS: usize = 50;
const MAX_SEARCH_RESULTS: usize = 100;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiscoveryFile {
    protocol: String,
    node: DiscoveryNode,
    endpoint: String,
    token: String,
    pid: u32,
    started_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DiscoveryNode {
    id: String,
    name: String,
    version: String,
}

#[derive(Debug, Deserialize)]
struct ContextRequest {
    subject: String,
    purpose: String,
    requested_by: String,
    #[serde(default)]
    wanted: WantedContext,
}

#[derive(Debug, Default, Deserialize)]
struct WantedContext {
    max_items: Option<usize>,
}

#[derive(Debug, Deserialize)]
struct SearchRequest {
    query: String,
    requested_by: String,
    category: Option<String>,
    limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProposalRequest {
    requested_by: String,
    source_title: Option<String>,
    source_provider: Option<String>,
    source_reference: Option<String>,
    claims: Vec<ProposalClaim>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProposalClaim {
    subject: Option<String>,
    key: String,
    value: Value,
    category: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
    epistemic_type: EpistemicType,
    confidence: Option<f64>,
    evidence: Option<String>,
    sensitivity: Option<Sensitivity>,
    valid_from: Option<String>,
    valid_until: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalContextSharingStatus {
    enabled: bool,
    contributions_enabled: bool,
    max_sensitivity: &'static str,
    resets_on_restart: bool,
}

pub struct LocalOosEndpoint {
    shutdown: Arc<AtomicBool>,
    sharing_enabled: Arc<AtomicBool>,
    contributions_enabled: Arc<AtomicBool>,
    discovery_path: PathBuf,
    token: String,
}

impl LocalOosEndpoint {
    pub fn start() -> Result<Self, String> {
        let directory = dirs::home_dir()
            .ok_or_else(|| "Unable to determine the home folder for TOPO local discovery.".to_owned())?
            .join(".topo");
        fs::create_dir_all(&directory)
            .map_err(|error| format!("Could not prepare TOPO local discovery: {error}"))?;

        let discovery_path = directory.join("oos-local.json");
        let server = Server::http("127.0.0.1:0")
            .map_err(|error| format!("Could not start TOPO local endpoint: {error}"))?;
        let endpoint = format!("http://{}", server.server_addr());
        let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
        let shutdown = Arc::new(AtomicBool::new(false));
        let sharing_enabled = Arc::new(AtomicBool::new(false));
        let contributions_enabled = Arc::new(AtomicBool::new(false));

        let discovery = DiscoveryFile {
            protocol: PROTOCOL.to_owned(),
            node: DiscoveryNode {
                id: "topo".to_owned(),
                name: "TOPO".to_owned(),
                version: env!("CARGO_PKG_VERSION").to_owned(),
            },
            endpoint,
            token: token.clone(),
            pid: std::process::id(),
            started_at: Utc::now().to_rfc3339(),
        };
        write_discovery(&discovery_path, &discovery)?;

        let server_token = token.clone();
        let server_shutdown = shutdown.clone();
        let server_sharing = sharing_enabled.clone();
        let server_contributions = contributions_enabled.clone();
        thread::Builder::new()
            .name("topo-oos-local".to_owned())
            .spawn(move || {
                while !server_shutdown.load(Ordering::Relaxed) {
                    let request = match server.recv_timeout(Duration::from_millis(250)) {
                        Ok(Some(request)) => request,
                        Ok(None) => continue,
                        Err(_) => break,
                    };
                    handle_request(
                        request,
                        &server_token,
                        &server_sharing,
                        &server_contributions,
                    );
                }
            })
            .map_err(|error| format!("Could not start TOPO local endpoint thread: {error}"))?;

        Ok(Self {
            shutdown,
            sharing_enabled,
            contributions_enabled,
            discovery_path,
            token,
        })
    }

    fn sharing_enabled(&self) -> bool {
        self.sharing_enabled.load(Ordering::Acquire)
    }

    fn set_sharing_enabled(&self, enabled: bool) {
        self.sharing_enabled.store(enabled, Ordering::Release);
    }

    fn contributions_enabled(&self) -> bool {
        self.contributions_enabled.load(Ordering::Acquire)
    }

    fn set_contributions_enabled(&self, enabled: bool) {
        self.contributions_enabled.store(enabled, Ordering::Release);
    }

    fn status(&self) -> LocalContextSharingStatus {
        LocalContextSharingStatus {
            enabled: self.sharing_enabled(),
            contributions_enabled: self.contributions_enabled(),
            max_sensitivity: "personal",
            resets_on_restart: true,
        }
    }
}

impl Drop for LocalOosEndpoint {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::Relaxed);

        let owned_by_this_process = fs::read_to_string(&self.discovery_path)
            .ok()
            .and_then(|content| serde_json::from_str::<DiscoveryFile>(&content).ok())
            .is_some_and(|discovery| discovery.token == self.token);

        if owned_by_this_process {
            let _ = fs::remove_file(&self.discovery_path);
        }
    }
}

#[tauri::command]
pub fn local_context_sharing_status(
    endpoint: tauri::State<'_, LocalOosEndpoint>,
) -> LocalContextSharingStatus {
    endpoint.status()
}

#[tauri::command]
pub fn set_local_context_sharing(
    endpoint: tauri::State<'_, LocalOosEndpoint>,
    enabled: bool,
) -> LocalContextSharingStatus {
    endpoint.set_sharing_enabled(enabled);
    endpoint.status()
}

#[tauri::command]
pub fn set_local_contributions(
    endpoint: tauri::State<'_, LocalOosEndpoint>,
    enabled: bool,
) -> LocalContextSharingStatus {
    endpoint.set_contributions_enabled(enabled);
    endpoint.status()
}

fn write_discovery(path: &Path, discovery: &DiscoveryFile) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "TOPO local discovery path has no parent folder.".to_owned())?;
    let temporary = parent.join(format!(".oos-local-{}.tmp", std::process::id()));
    let content = serde_json::to_vec_pretty(discovery)
        .map_err(|error| format!("Could not encode TOPO local discovery: {error}"))?;
    fs::write(&temporary, content)
        .map_err(|error| format!("Could not write TOPO local discovery: {error}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("Could not secure TOPO local discovery: {error}"))?;
    }

    if path.exists() {
        let metadata = fs::symlink_metadata(path)
            .map_err(|error| format!("Could not inspect existing TOPO discovery: {error}"))?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            let _ = fs::remove_file(&temporary);
            return Err("TOPO local discovery path is not an ordinary file.".to_owned());
        }
        fs::remove_file(path)
            .map_err(|error| format!("Could not replace stale TOPO discovery: {error}"))?;
    }

    fs::rename(&temporary, path)
        .map_err(|error| format!("Could not publish TOPO local discovery: {error}"))?;
    Ok(())
}

fn json_response(value: Value, status: u16) -> Response<std::io::Cursor<Vec<u8>>> {
    let body = serde_json::to_vec(&value).unwrap_or_else(|_| b"{\"error\":\"encoding\"}".to_vec());
    let mut response = Response::from_data(body).with_status_code(StatusCode(status));
    if let Ok(header) = Header::from_bytes("Content-Type", "application/json") {
        response.add_header(header);
    }
    response
}

fn authorised(request: &tiny_http::Request, token: &str) -> bool {
    let expected = format!("Bearer {token}");
    request
        .headers()
        .iter()
        .find(|header| header.field.equiv("Authorization"))
        .is_some_and(|header| header.value.as_str() == expected)
}

fn read_json<T: for<'de> Deserialize<'de>>(
    request: &mut tiny_http::Request,
) -> Result<T, Response<std::io::Cursor<Vec<u8>>>> {
    let mut body = String::new();
    if request
        .as_reader()
        .take((MAX_BODY_BYTES + 1) as u64)
        .read_to_string(&mut body)
        .is_err()
        || body.len() > MAX_BODY_BYTES
    {
        return Err(json_response(
            json!({ "error": "request body exceeds 128 KiB" }),
            413,
        ));
    }

    serde_json::from_str::<T>(&body).map_err(|error| {
        json_response(
            json!({ "error": format!("invalid request: {error}") }),
            400,
        )
    })
}

fn handle_request(
    mut request: tiny_http::Request,
    token: &str,
    sharing_enabled: &Arc<AtomicBool>,
    contributions_enabled: &Arc<AtomicBool>,
) {
    if !authorised(&request, token) {
        let _ = request.respond(json_response(json!({ "error": "unauthorised" }), 401));
        return;
    }

    let sharing = sharing_enabled.load(Ordering::Acquire);
    let contributions = contributions_enabled.load(Ordering::Acquire);

    match (request.method(), request.url()) {
        (&Method::Get, "/v0/capabilities") => {
            let queries: Vec<&str> = if sharing {
                vec!["context", "search"]
            } else {
                vec![]
            };
            let actions: Vec<&str> = if contributions {
                vec!["propose_claims"]
            } else {
                vec![]
            };
            let accepts: Vec<&str> = if contributions {
                vec!["candidate-memory-proposals"]
            } else {
                vec![]
            };
            let _ = request.respond(json_response(
                json!({
                    "protocol": "oos/0.1-draft",
                    "node": {
                        "id": "topo",
                        "name": "TOPO",
                        "version": env!("CARGO_PKG_VERSION")
                    },
                    "provides": queries,
                    "emits": [],
                    "accepts": accepts,
                    "queries": queries,
                    "actions": actions,
                    "extensions": {
                        "transport": PROTOCOL,
                        "scope": "local-only",
                        "sensitivity_ceiling": "personal",
                        "sharing_enabled": sharing,
                        "contributions_enabled": contributions,
                        "review_authority": false,
                        "sharing_resets_on_restart": true
                    }
                }),
                200,
            ));
        }
        (&Method::Post, "/v0/context") => {
            if !sharing {
                let _ = request.respond(json_response(
                    json!({
                        "error": "local context sharing is disabled in TOPO",
                        "code": "TOPO_LOCAL_SHARING_DISABLED"
                    }),
                    403,
                ));
                return;
            }

            let parsed = match read_json::<ContextRequest>(&mut request) {
                Ok(parsed) => parsed,
                Err(response) => {
                    let _ = request.respond(response);
                    return;
                }
            };

            let max_items = parsed.wanted.max_items.unwrap_or(20);
            match super::resolve_local_context(
                &parsed.subject,
                &parsed.purpose,
                &parsed.requested_by,
                max_items,
            ) {
                Ok(packet) => {
                    let _ = request.respond(json_response(packet, 200));
                }
                Err(error) => {
                    let _ = request.respond(json_response(json!({ "error": error }), 400));
                }
            }
        }
        (&Method::Post, "/v0/search") => {
            if !sharing {
                let _ = request.respond(json_response(
                    json!({
                        "error": "local context sharing is disabled in TOPO",
                        "code": "TOPO_LOCAL_SHARING_DISABLED"
                    }),
                    403,
                ));
                return;
            }
            let parsed = match read_json::<SearchRequest>(&mut request) {
                Ok(parsed) => parsed,
                Err(response) => {
                    let _ = request.respond(response);
                    return;
                }
            };
            match local_search(parsed) {
                Ok(value) => {
                    let _ = request.respond(json_response(value, 200));
                }
                Err(error) => {
                    let _ = request.respond(json_response(json!({ "error": error }), 400));
                }
            }
        }
        (&Method::Post, "/v0/proposals") => {
            if !contributions {
                let _ = request.respond(json_response(
                    json!({
                        "error": "local memory contributions are disabled in TOPO",
                        "code": "TOPO_LOCAL_CONTRIBUTIONS_DISABLED"
                    }),
                    403,
                ));
                return;
            }
            let parsed = match read_json::<ProposalRequest>(&mut request) {
                Ok(parsed) => parsed,
                Err(response) => {
                    let _ = request.respond(response);
                    return;
                }
            };
            match create_local_proposals(parsed) {
                Ok(value) => {
                    let _ = request.respond(json_response(value, 200));
                }
                Err(error) => {
                    let _ = request.respond(json_response(json!({ "error": error }), 400));
                }
            }
        }
        _ => {
            let _ = request.respond(json_response(json!({ "error": "not found" }), 404));
        }
    }
}

fn local_search(input: SearchRequest) -> Result<Value, String> {
    if input.query.trim().is_empty() || input.requested_by.trim().is_empty() {
        return Err("query and requestedBy are required.".to_owned());
    }
    let limit = input.limit.unwrap_or(20);
    if !(1..=MAX_SEARCH_RESULTS).contains(&limit) {
        return Err(format!("limit must be between 1 and {MAX_SEARCH_RESULTS}."));
    }

    let connection = super::open_store()?;
    let now = Utc::now();
    let needle = input.query.trim().to_lowercase();
    let mut results = super::all_claims(&connection)?
        .into_iter()
        .filter(|claim| claim.status == ClaimStatus::Confirmed)
        .filter(|claim| matches!(claim.sensitivity, Sensitivity::Ordinary | Sensitivity::Personal))
        .filter(|claim| super::is_current(claim, &now))
        .filter(|claim| {
            input
                .category
                .as_ref()
                .map(|category| claim.category.as_deref() == Some(category.as_str()))
                .unwrap_or(true)
        })
        .filter_map(|claim| {
            let score = lexical_score(&claim, &needle);
            (score > 0).then_some((claim, score))
        })
        .collect::<Vec<_>>();

    results.sort_by(|(left, left_score), (right, right_score)| {
        right_score
            .cmp(left_score)
            .then_with(|| right.updated_at.cmp(&left.updated_at))
            .then_with(|| left.id.cmp(&right.id))
    });
    results.truncate(limit);

    Ok(json!({
        "requestedBy": input.requested_by,
        "query": input.query,
        "results": results.into_iter().map(|(claim, score)| json!({
            "claim": claim,
            "score": score
        })).collect::<Vec<_>>()
    }))
}

fn lexical_score(claim: &MemoryClaim, needle: &str) -> i64 {
    let key = claim.key.to_lowercase();
    let category = claim.category.clone().unwrap_or_default().to_lowercase();
    let tags = claim
        .tags
        .iter()
        .map(|tag| tag.to_lowercase())
        .collect::<Vec<_>>();
    let value = serde_json::to_string(&claim.value)
        .unwrap_or_default()
        .to_lowercase();

    let mut score = 0i64;
    if key == needle {
        score += 100;
    } else if key.contains(needle) {
        score += 45;
    }
    if category == needle {
        score += 35;
    } else if category.contains(needle) {
        score += 15;
    }
    if value.contains(needle) {
        score += 30;
    }
    for tag in &tags {
        if tag == needle {
            score += 25;
        } else if tag.contains(needle) {
            score += 10;
        }
    }
    for token in needle.split_whitespace() {
        if key.contains(token) {
            score += 8;
        }
        if category.contains(token) {
            score += 4;
        }
        if value.contains(token) {
            score += 5;
        }
        if tags.iter().any(|tag| tag.contains(token)) {
            score += 4;
        }
    }
    score
}

fn create_local_proposals(input: ProposalRequest) -> Result<Value, String> {
    let connection = super::open_store()?;
    create_local_proposals_in(&connection, input)
}

fn create_local_proposals_in(
    connection: &Connection,
    input: ProposalRequest,
) -> Result<Value, String> {
    if input.requested_by.trim().is_empty() {
        return Err("requestedBy is required.".to_owned());
    }
    if input.claims.is_empty() || input.claims.len() > MAX_PROPOSALS {
        return Err(format!(
            "claims must contain between 1 and {MAX_PROPOSALS} proposals."
        ));
    }

    for claim in &input.claims {
        validate_proposal(claim)?;
    }

    let tx = connection.unchecked_transaction().map_err(super::error_text)?;
    let now = Utc::now().to_rfc3339();
    let source_id = format!("source-{}", Uuid::new_v4());
    let sensitivity = maximum_sensitivity(&input.claims);
    let source = MemorySource {
        id: source_id,
        source_type: SourceType::Mcp,
        title: input
            .source_title
            .clone()
            .or_else(|| Some(format!("Local proposal from {}", input.requested_by))),
        provider: input.source_provider.clone(),
        external_id: input.source_reference.clone(),
        captured_at: now.clone(),
        created_at: now.clone(),
        sensitivity,
        metadata: Some(BTreeMap::from([
            (
                "topo.local.requestedBy".to_owned(),
                Value::String(input.requested_by.clone()),
            ),
            (
                "topo.local.reviewAuthority".to_owned(),
                Value::Bool(false),
            ),
        ])),
    };

    write_source(&tx, &source)?;
    super::append_event(
        &tx,
        &MemoryEvent {
            id: format!("event-{}", Uuid::new_v4()),
            event_type: EventType::SourceCaptured,
            entity_type: EventEntityType::Source,
            entity_id: source.id.clone(),
            occurred_at: now.clone(),
            actor: Actor {
                actor_type: ActorType::Agent,
                id: Some(input.requested_by.clone()),
            },
            data: Some(BTreeMap::from([(
                "claimCount".to_owned(),
                json!(input.claims.len()),
            )])),
        },
    )?;

    let mut active_claims = super::all_claims(&tx)?
        .into_iter()
        .filter(|claim| {
            claim.status == ClaimStatus::Confirmed || claim.status == ClaimStatus::Candidate
        })
        .collect::<Vec<_>>();

    let mut claims = Vec::with_capacity(input.claims.len());
    let mut supporting_evidence_added = Vec::<String>::new();
    let mut duplicates_skipped = 0usize;
    let mut potential_changes = 0usize;

    for proposal in input.claims {
        let subject = proposal.subject.unwrap_or_else(|| "self".to_owned());
        let key = proposal.key.trim().to_owned();

        let same_key = active_claims
            .iter()
            .filter(|claim| claim.subject == subject && claim.key == key)
            .collect::<Vec<_>>();

        if let Some(exact) = same_key
            .iter()
            .find(|claim| claim.value == proposal.value)
            .copied()
        {
            if let Some(evidence) = proposal
                .evidence
                .as_ref()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
            {
                super::append_event(
                    &tx,
                    &MemoryEvent {
                        id: format!("event-{}", Uuid::new_v4()),
                        event_type: EventType::ClaimEvidenceAdded,
                        entity_type: EventEntityType::Claim,
                        entity_id: exact.id.clone(),
                        occurred_at: now.clone(),
                        actor: Actor {
                            actor_type: ActorType::Agent,
                            id: Some(input.requested_by.clone()),
                        },
                        data: Some(BTreeMap::from([
                            ("sourceId".to_owned(), Value::String(source.id.clone())),
                            ("sourceType".to_owned(), Value::String("mcp".to_owned())),
                            (
                                "provider".to_owned(),
                                Value::String(input.source_provider.clone().unwrap_or_default()),
                            ),
                            ("capturedAt".to_owned(), Value::String(now.clone())),
                            ("evidence".to_owned(), Value::String(evidence.to_owned())),
                            (
                                "origin".to_owned(),
                                Value::String("local-tool".to_owned()),
                            ),
                        ])),
                    },
                )?;
                supporting_evidence_added.push(exact.id.clone());
            } else {
                duplicates_skipped += 1;
            }
            continue;
        }

        let supersedes = same_key
            .iter()
            .filter(|claim| claim.status == ClaimStatus::Confirmed)
            .map(|claim| claim.id.clone())
            .collect::<Vec<_>>();
        let is_change = !supersedes.is_empty();
        if is_change {
            potential_changes += 1;
        }

        let mut tags = proposal
            .tags
            .into_iter()
            .map(|tag| tag.trim().to_owned())
            .filter(|tag| !tag.is_empty())
            .collect::<Vec<_>>();
        if is_change {
            tags.push("topo:potential-change".to_owned());
        }
        tags.sort();
        tags.dedup();

        let claim = MemoryClaim {
            id: format!("claim-{}", Uuid::new_v4()),
            subject,
            key,
            value: proposal.value,
            category: proposal
                .category
                .and_then(|value| (!value.trim().is_empty()).then(|| value.trim().to_owned())),
            tags,
            epistemic_type: proposal.epistemic_type,
            confidence: proposal.confidence.unwrap_or(0.8),
            provenance: ClaimProvenance {
                source_type: SourceType::Mcp,
                provider: input.source_provider.clone(),
                source_id: Some(source.id.clone()),
                evidence: proposal.evidence,
                captured_at: now.clone(),
            },
            status: ClaimStatus::Candidate,
            sensitivity: proposal.sensitivity.unwrap_or(Sensitivity::Ordinary),
            valid_from: proposal.valid_from,
            valid_until: proposal.valid_until,
            supersedes,
            created_at: now.clone(),
            updated_at: now.clone(),
        };

        super::write_claim(&tx, &claim)?;
        super::append_event(
            &tx,
            &MemoryEvent {
                id: format!("event-{}", Uuid::new_v4()),
                event_type: EventType::ClaimProposed,
                entity_type: EventEntityType::Claim,
                entity_id: claim.id.clone(),
                occurred_at: now.clone(),
                actor: Actor {
                    actor_type: ActorType::Agent,
                    id: Some(input.requested_by.clone()),
                },
                data: Some(BTreeMap::from([
                    ("origin".to_owned(), Value::String("local-tool".to_owned())),
                    ("reviewAuthority".to_owned(), Value::Bool(false)),
                    ("potentialChange".to_owned(), Value::Bool(is_change)),
                ])),
            },
        )?;
        active_claims.push(claim.clone());
        claims.push(claim);
    }

    tx.commit().map_err(super::error_text)?;
    Ok(json!({
        "source": source,
        "claims": claims,
        "supportingEvidenceAdded": supporting_evidence_added,
        "duplicatesSkipped": duplicates_skipped,
        "potentialChanges": potential_changes,
        "reviewRequired": true
    }))
}

fn validate_proposal(claim: &ProposalClaim) -> Result<(), String> {
    if claim.key.trim().is_empty() {
        return Err("proposal key is required.".to_owned());
    }
    let confidence = claim.confidence.unwrap_or(0.8);
    if !confidence.is_finite() || !(0.0..=1.0).contains(&confidence) {
        return Err(format!("confidence for {} must be between 0 and 1.", claim.key));
    }
    let sensitivity = claim.sensitivity.clone().unwrap_or(Sensitivity::Ordinary);
    if !matches!(sensitivity, Sensitivity::Ordinary | Sensitivity::Personal) {
        return Err(format!(
            "{} exceeds the local contribution sensitivity ceiling of personal.",
            claim.key
        ));
    }
    if let Some(valid_from) = &claim.valid_from {
        chrono::DateTime::parse_from_rfc3339(valid_from)
            .map_err(|_| format!("validFrom for {} is not RFC3339.", claim.key))?;
    }
    if let Some(valid_until) = &claim.valid_until {
        chrono::DateTime::parse_from_rfc3339(valid_until)
            .map_err(|_| format!("validUntil for {} is not RFC3339.", claim.key))?;
    }
    Ok(())
}

fn maximum_sensitivity(claims: &[ProposalClaim]) -> Sensitivity {
    if claims
        .iter()
        .any(|claim| claim.sensitivity == Some(Sensitivity::Personal))
    {
        Sensitivity::Personal
    } else {
        Sensitivity::Ordinary
    }
}

fn write_source(connection: &Connection, source: &MemorySource) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO sources (
               id, type, title, provider, external_id, captured_at,
               created_at, sensitivity, metadata_json
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                source.id,
                super::enum_text(&source.source_type)?,
                source.title,
                source.provider,
                source.external_id,
                source.captured_at,
                source.created_at,
                super::enum_text(&source.sensitivity)?,
                source
                    .metadata
                    .as_ref()
                    .map(serde_json::to_string)
                    .transpose()
                    .map_err(super::error_text)?,
            ],
        )
        .map_err(super::error_text)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn endpoint_for_test(path: PathBuf, token: &str) -> LocalOosEndpoint {
        LocalOosEndpoint {
            shutdown: Arc::new(AtomicBool::new(false)),
            sharing_enabled: Arc::new(AtomicBool::new(false)),
            contributions_enabled: Arc::new(AtomicBool::new(false)),
            discovery_path: path,
            token: token.to_owned(),
        }
    }

    #[test]
    fn local_read_and_contribution_authority_are_separate() {
        let directory = tempfile::tempdir().unwrap();
        let endpoint = endpoint_for_test(directory.path().join("missing.json"), "test-token");

        assert!(!endpoint.sharing_enabled());
        assert!(!endpoint.contributions_enabled());

        endpoint.set_sharing_enabled(true);
        assert!(endpoint.sharing_enabled());
        assert!(!endpoint.contributions_enabled());

        endpoint.set_contributions_enabled(true);
        assert!(endpoint.sharing_enabled());
        assert!(endpoint.contributions_enabled());

        endpoint.set_sharing_enabled(false);
        assert!(!endpoint.sharing_enabled());
        assert!(endpoint.contributions_enabled());
    }

    #[test]
    fn proposal_validation_never_allows_sensitive_local_writes() {
        let claim = ProposalClaim {
            subject: None,
            key: "private.health".to_owned(),
            value: Value::String("example".to_owned()),
            category: None,
            tags: Vec::new(),
            epistemic_type: EpistemicType::Assertion,
            confidence: Some(0.9),
            evidence: None,
            sensitivity: Some(Sensitivity::Sensitive),
            valid_from: None,
            valid_until: None,
        };

        assert!(validate_proposal(&claim).is_err());
    }

    fn proposal_request(value: &str, evidence: Option<&str>) -> ProposalRequest {
        ProposalRequest {
            requested_by: "claude-desktop".to_owned(),
            source_title: Some("Claude test".to_owned()),
            source_provider: Some("anthropic".to_owned()),
            source_reference: None,
            claims: vec![ProposalClaim {
                subject: Some("self".to_owned()),
                key: "writing.locale".to_owned(),
                value: Value::String(value.to_owned()),
                category: Some("writing".to_owned()),
                tags: vec!["writing".to_owned()],
                epistemic_type: EpistemicType::Preference,
                confidence: Some(0.95),
                evidence: evidence.map(str::to_owned),
                sensitivity: Some(Sensitivity::Ordinary),
                valid_from: None,
                valid_until: None,
            }],
        }
    }

    #[test]
    fn exact_local_proposal_adds_evidence_instead_of_duplicate_candidate() {
        let connection = Connection::open_in_memory().unwrap();
        crate::migrate(&connection).unwrap();

        create_local_proposals_in(
            &connection,
            proposal_request("en-GB", Some("Please use British English.")),
        )
        .unwrap();

        let candidate = crate::all_claims(&connection).unwrap().remove(0);
        crate::review_candidate_in(&connection, &candidate.id, "confirm").unwrap();

        let repeated = create_local_proposals_in(
            &connection,
            proposal_request("en-GB", Some("Still use British English.")),
        )
        .unwrap();

        assert_eq!(
            repeated
                .get("claims")
                .and_then(Value::as_array)
                .unwrap()
                .len(),
            0
        );
        assert_eq!(
            repeated
                .get("supportingEvidenceAdded")
                .and_then(Value::as_array)
                .unwrap()
                .len(),
            1
        );
        assert_eq!(crate::all_claims(&connection).unwrap().len(), 1);

        let evidence_events: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM events WHERE type = 'claim.evidence_added'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(evidence_events, 1);
    }

    #[test]
    fn changed_local_proposal_is_a_reviewable_replacement() {
        let connection = Connection::open_in_memory().unwrap();
        crate::migrate(&connection).unwrap();

        create_local_proposals_in(
            &connection,
            proposal_request("en-GB", Some("Use British English.")),
        )
        .unwrap();

        let original = crate::all_claims(&connection).unwrap().remove(0);
        crate::review_candidate_in(&connection, &original.id, "confirm").unwrap();

        let changed = create_local_proposals_in(
            &connection,
            proposal_request("en-US", Some("Use American English for this project.")),
        )
        .unwrap();

        assert_eq!(
            changed
                .get("potentialChanges")
                .and_then(Value::as_u64),
            Some(1)
        );

        let claims = crate::all_claims(&connection).unwrap();
        let replacement = claims
            .iter()
            .find(|claim| claim.status == ClaimStatus::Candidate)
            .unwrap();
        assert_eq!(replacement.supersedes, vec![original.id.clone()]);
        assert!(replacement.tags.contains(&"topo:potential-change".to_owned()));

        crate::review_candidate_in(&connection, &replacement.id, "confirm").unwrap();
        let claims = crate::all_claims(&connection).unwrap();
        let previous = claims.iter().find(|claim| claim.id == original.id).unwrap();
        assert_eq!(previous.status, ClaimStatus::Superseded);
    }

    #[test]
    fn discovery_file_is_private_on_unix() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("oos-local.json");
        let discovery = DiscoveryFile {
            protocol: PROTOCOL.to_owned(),
            node: DiscoveryNode {
                id: "topo".to_owned(),
                name: "TOPO".to_owned(),
                version: "0.1.0-test".to_owned(),
            },
            endpoint: "http://127.0.0.1:12345".to_owned(),
            token: "test-token".to_owned(),
            pid: 1,
            started_at: "2026-08-31T09:00:00Z".to_owned(),
        };

        write_discovery(&path, &discovery).unwrap();

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        }
    }

    #[test]
    fn discovery_cleanup_does_not_remove_a_newer_endpoint() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("oos-local.json");
        let newer = DiscoveryFile {
            protocol: PROTOCOL.to_owned(),
            node: DiscoveryNode {
                id: "topo".to_owned(),
                name: "TOPO".to_owned(),
                version: "0.1.0-test".to_owned(),
            },
            endpoint: "http://127.0.0.1:12345".to_owned(),
            token: "newer-token".to_owned(),
            pid: 2,
            started_at: "2026-08-31T09:01:00Z".to_owned(),
        };
        write_discovery(&path, &newer).unwrap();

        {
            let endpoint = endpoint_for_test(path.clone(), "older-token");
            drop(endpoint);
        }

        assert!(path.exists());
    }
}

import asyncio
from datetime import datetime, timezone

from app.repository import AnalysisRepository, _view
from app.routes import ClientAnalysisRequest


class MemoryCollection:
    def __init__(self):
        self.document = None

    async def insert_one(self, document):
        self.document = document

    async def find_one(self, query):
        return self.document


def _request():
    return {
        "assignmentId": "assignment-1",
        "evidenceId": "evidence-1",
        "runId": "run-1",
        "modelVersion": "mobile-v1",
        "imageSha256": "a" * 64,
        "labels": [{"name": "dent", "score": 0.8}],
        "humanReview": {"modelVersion": "mobile-v1", "labels": []},
    }


def test_client_request_keeps_human_review_separate_and_model_scoped():
    payload = ClientAnalysisRequest.model_validate(_request())
    assert payload.labels[0].name == "dent"
    assert payload.humanReview.modelVersion == payload.modelVersion
    assert payload.humanReview.labels == []


def test_client_analysis_repository_persists_prediction_and_human_review_as_separate_fields():
    collection = MemoryCollection()
    repository = object.__new__(AnalysisRepository)
    repository._collection = collection
    created = datetime.now(timezone.utc)

    result = asyncio.run(repository.save_client_analysis({
        **_request(),
        "subject": "mechanic-subject",
        "roles": ("mecanico",),
    }))

    assert collection.document["labels"] == [{"name": "dent", "score": 0.8}]
    assert collection.document["humanReview"]["labels"] == []
    assert collection.document["humanReview"]["modelVersion"] == "mobile-v1"
    assert collection.document["humanReview"]["recordedAt"].tzinfo == timezone.utc
    assert result["labels"] == [{"name": "dent", "score": 0.8}]
    assert result["humanReview"]["labels"] == []
    assert result["verifiedByServer"] is False


def test_vision_views_keep_client_records_distinct_from_server_predictions():
    document = {
        "analysisId": "analysis-1",
        "origin": "client",
        "assignmentId": "assignment-1",
        "evidenceId": "evidence-1",
        "runId": "run-1",
        "modelVersion": "mobile-v1",
        "imageSha256": "a" * 64,
        "labels": [{"name": "dent", "score": 0.8}],
        "humanReview": {"modelVersion": "mobile-v1", "labels": [], "recordedAt": datetime(2026, 11, 4, tzinfo=timezone.utc)},
        "createdAt": datetime(2026, 11, 4, tzinfo=timezone.utc),
    }
    view = _view(document)
    assert view["origin"] == "client"
    assert view["verifiedByServer"] is False
    assert view["humanReview"]["modelVersion"] == "mobile-v1"
    assert view["humanReview"]["recordedAt"].endswith("Z")

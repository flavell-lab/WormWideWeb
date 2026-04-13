from django.shortcuts import render
from django.views.decorators.cache import cache_page
from django.http import HttpResponse
from django.db import connection
from django.views.decorators.http import require_GET
from django.urls import reverse
from django.conf import settings
from connectome.views import connectome_datasets
from activity.models import GCaMPDataset
from collections import defaultdict
from pathlib import Path
import json

CORE_PAGE_CACHE_TTL = 60 * 60 * 6


@cache_page(CORE_PAGE_CACHE_TTL)
def index(request):
    context = {}

    return render(request, "core/index.html", context)


@cache_page(CORE_PAGE_CACHE_TTL)
def about(request):
    context = {"connectome_data": json.loads(connectome_datasets())}

    return render(request, "core/about.html", context)


def _load_activity_paper_metadata():
    metadata_path = Path(settings.BASE_DIR).parent / "initial_data" / "activity" / "papers.json"
    if not metadata_path.exists():
        return {}

    try:
        with metadata_path.open("r") as file:
            papers = json.load(file)
    except Exception:
        return {}

    if not isinstance(papers, list):
        return {}

    metadata = {}
    for paper in papers:
        if not isinstance(paper, dict):
            continue
        paper_id = paper.get("paper_id")
        if not paper_id:
            continue
        metadata[paper_id] = paper

    return metadata


def _build_repository_url(metadata_entry):
    if not isinstance(metadata_entry, dict):
        return None

    repository = metadata_entry.get("repository")
    if not isinstance(repository, dict):
        return None

    repo_type = str(repository.get("type", "")).strip().lower()
    record_id = str(repository.get("record_id", "")).strip()
    if not record_id:
        return None

    if record_id.startswith("http://") or record_id.startswith("https://"):
        return record_id

    if repo_type == "zenodo":
        return f"https://zenodo.org/records/{record_id}"
    if repo_type == "dryad":
        return f"https://doi.org/{record_id}"
    return None


def _format_paper_tooltip(title_full):
    title = str(title_full or "")
    title = title.replace("Caenorhabditis elegans", "<i>Caenorhabditis elegans</i>")
    title = title.replace("C. elegans", "<i>C. elegans</i>")
    return title


def _coverage_badge(count, total, include_counts=False):
    if total <= 0 or count <= 0:
        return {"label": "Not Available", "variant": "secondary"}
    if count >= total:
        return {"label": "All", "variant": "success"}
    if include_counts:
        return {"label": f"Partial ({count} of {total})", "variant": "warning"}
    return {"label": "Partial", "variant": "warning"}


def about_datasets(request):
    paper_stats = defaultdict(
        lambda: {
            "paper_id": "",
            "title_short": "",
            "title_full": "",
            "total_datasets": 0,
            "neuropal_datasets": 0,
            "encoding_datasets": 0,
        }
    )

    dataset_rows = GCaMPDataset.objects.select_related("paper").only(
        "paper__paper_id",
        "paper__title_short",
        "paper__title_full",
        "n_labeled",
        "encoding",
    )

    for dataset in dataset_rows:
        if dataset.paper is None:
            continue

        paper_id = dataset.paper.paper_id
        stats = paper_stats[paper_id]
        stats["paper_id"] = paper_id
        stats["title_short"] = dataset.paper.title_short
        stats["title_full"] = dataset.paper.title_full
        stats["total_datasets"] += 1

        if dataset.n_labeled > 0:
            stats["neuropal_datasets"] += 1
        if bool(dataset.encoding):
            stats["encoding_datasets"] += 1

    paper_metadata = _load_activity_paper_metadata()
    dataset_papers = []

    for paper_id, stats in paper_stats.items():
        total = stats["total_datasets"]
        neuropal_badge = _coverage_badge(
            stats["neuropal_datasets"], total, include_counts=True
        )
        encoding_badge = _coverage_badge(stats["encoding_datasets"], total)
        repository_url = _build_repository_url(paper_metadata.get(paper_id, {}))

        dataset_papers.append(
            {
                "paper_id": paper_id,
                "title_short": stats["title_short"],
                "title_tooltip_html": _format_paper_tooltip(stats["title_full"]),
                "total_datasets": total,
                "neuropal_badge": neuropal_badge,
                "encoding_badge": encoding_badge,
                "open_url": f"{reverse('activity-dataset')}?p={paper_id}",
                "hdf_repository_url": repository_url,
                "json_archive_url": reverse(
                    "activity-download_paper_archive", args=[paper_id]
                ),
            }
        )

    dataset_papers.sort(key=lambda row: row["title_short"].lower())

    context = {"dataset_papers": dataset_papers}

    return render(request, "core/about_datasets.html", context)


def is_healthy(request):
    try:
        connection.ensure_connection()
        return HttpResponse("OK", status=200)
    except Exception:
        return HttpResponse("ERROR", status=500)  # failure


@require_GET
def robots_txt(request):

    return render(request, "robots.txt", {}, content_type="text/plain")

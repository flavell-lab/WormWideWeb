from django.shortcuts import render
from django.views.decorators.cache import cache_page
from django.http import HttpResponse
from django.db import connection
from django.views.decorators.http import require_GET
from connectome.views import connectome_datasets
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


def about_datasets(request):
    context = {}

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

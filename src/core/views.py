from django.shortcuts import render
from django.views.decorators.cache import cache_page
from django.http import HttpResponse
from django.db import connection
from django.views.decorators.http import require_GET

@cache_page(60*60*24*30)
def index(request):
    context = {}
    
    return render(request, "core/index.html",context)

@cache_page(60*60*24*30)
def about(request):
    context = {}

    return render(request, "core/about.html", context)

def is_healthy(request):
    try:
        connection.ensure_connection()
        return HttpResponse("OK", status=200)
    except Exception as e:
        return HttpResponse("ERROR", status=500) # failure
    
@require_GET
def robots_txt(request):

    return render(request, "robots.txt", {}, content_type="text/plain")

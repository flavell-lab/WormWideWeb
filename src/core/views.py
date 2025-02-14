from django.shortcuts import render
from django.views.decorators.cache import cache_page

@cache_page(60*60*24*30)
def index(request):
    context = {}
    
    return render(request, "core/index.html",context)

@cache_page(60*60*24*30)
def about(request):
    context = {}

    return render(request, "core/about.html", context)

from django.shortcuts import render

def index(request):
    context = {}
    
    return render(request, "core/index.html",context)

def about(request):
    context = {}

    return render(request, "core/about.html", context)

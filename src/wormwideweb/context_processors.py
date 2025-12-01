from django.conf import settings

def import_cdn(request):
    return {"IMPORT_CDN": settings.IMPORT_CDN}
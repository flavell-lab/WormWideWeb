from django.urls import path
from . import views

urlpatterns = [
    path('', views.index, name='index'),
    path('about/', views.about, name="about"),
    path('is_healthy/', views.is_healthy, name="health_check")
]
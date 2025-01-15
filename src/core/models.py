from django.db import models

def empty_json():
    return {}

class JSONCache(models.Model):
    def __str__(self):
        return self.name
    
    name = models.CharField(max_length=100, unique=True)
    json = models.JSONField(default=empty_json)
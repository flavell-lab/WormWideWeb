from django import template

register = template.Library()

@register.filter
def get_type_class(type):
    type_map = {
        'baseline': 'secondary',
        'heat': 'danger',
        'neuropal': 'primary',
        'gfp': 'success',
    }
    return type_map.get(type, '')  # Return empty string if type not found

@register.filter
def get_type_name(type):
    type_map = {
        'baseline': 'Baseline',
        'heat': 'Heat',
        'neuropal': 'NeuroPAL',
        'gfp': 'GFP',
    }
    return type_map.get(type, '')  # Return empty string if type not found
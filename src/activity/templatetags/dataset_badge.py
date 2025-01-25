from django import template

register = template.Library()

@register.filter
def get_type_class(type):
    type_map = {
        # atanas & kim et al. 2023
        'baseline': 'secondary',
        'heat': 'danger',
        'neuropal': 'primary',
        'gfp': 'success',
        # dag, nwabudike & kang et al. 2023
        'patchEncounter': 'info',
        'reFed': 'light',
        # pradhan & mahan et al. 2024
        'sickness': 'dark',
    }
    return type_map.get(type, '')  # Return empty string if type not found

@register.filter
def get_type_name(type):
    type_map = {
        # atanas & kim et al. 2023
        'baseline': 'Baseline',
        'heat': 'Heat',
        'neuropal': 'NeuroPAL',
        'gfp': 'GFP',
        # dag, nwabudike & kang et al. 2023
        'patchEncounter': 'Patch',
        'reFed': 'Re-fed',
        # pradhan & mahan et al. 2024
        'sickness': 'Sickness',
    }
    return type_map.get(type, '')  # Return empty string if type not found
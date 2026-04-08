from django.db import migrations, models
import django.db.models.deletion
from django.db.models import Q


class Migration(migrations.Migration):
    dependencies = [
        ("activity", "0002_gcampdataset_dataset_sha256"),
    ]

    operations = [
        migrations.CreateModel(
            name="GCaMPEventStyle",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("event_id", models.CharField(max_length=100)),
                ("color", models.CharField(default="rgba(255,0,0,1)", max_length=50)),
                ("width", models.FloatField(default=2.0)),
                (
                    "paper",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="event_styles",
                        to="activity.gcamppaper",
                    ),
                ),
            ],
            options={
                "verbose_name": "GCaMP Event Style",
                "verbose_name_plural": "GCaMP Event Styles",
            },
        ),
        migrations.AddConstraint(
            model_name="gcampeventstyle",
            constraint=models.UniqueConstraint(
                fields=("paper", "event_id"),
                name="unique_event_style_per_paper",
            ),
        ),
        migrations.AddConstraint(
            model_name="gcampeventstyle",
            constraint=models.UniqueConstraint(
                condition=Q(("paper__isnull", True)),
                fields=("event_id",),
                name="unique_common_event_style",
            ),
        ),
    ]

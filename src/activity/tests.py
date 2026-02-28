import json
from unittest.mock import patch

from django.http import Http404
from django.test import RequestFactory, SimpleTestCase

from activity.views import get_neural_trace, plot_multiple_data


class PlotMultipleDataTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def test_plot_multiple_data_rejects_non_post(self):
        request = self.factory.get("/activity/plot-multiple-data/")
        response = plot_multiple_data(request)
        self.assertEqual(response.status_code, 405)

    def test_plot_multiple_data_rejects_invalid_json(self):
        request = self.factory.post(
            "/activity/plot-multiple-data/",
            data="not-json",
            content_type="application/json",
        )
        response = plot_multiple_data(request)
        self.assertEqual(response.status_code, 400)

    def test_plot_multiple_data_rejects_invalid_schema(self):
        payload = {"dataset-a": ["1", "2"]}
        request = self.factory.post(
            "/activity/plot-multiple-data/",
            data=json.dumps(payload),
            content_type="application/json",
        )
        response = plot_multiple_data(request)
        self.assertEqual(response.status_code, 400)

    @patch("activity.views.cache.set")
    @patch("activity.views.uuid.uuid4")
    def test_plot_multiple_data_accepts_valid_payload(self, mock_uuid4, mock_cache_set):
        mock_uuid4.return_value.hex = "abc123"
        payload = {"dataset-a": [3, 2, 2, 1]}
        request = self.factory.post(
            "/activity/plot-multiple-data/",
            data=json.dumps(payload),
            content_type="application/json",
        )

        response = plot_multiple_data(request)
        self.assertEqual(response.status_code, 200)
        body = json.loads(response.content)
        self.assertEqual(body["status"], "success")
        self.assertTrue(body["redirect"].endswith("token=abc123"))
        mock_cache_set.assert_called_once_with(
            "plot_multiple_data:abc123",
            {"dataset-a": [3, 2, 1]},
            timeout=600,
        )


class NeuralTraceViewTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    @patch("activity.views.get_neural_trace_data")
    def test_get_neural_trace_returns_json(self, mock_trace_data):
        mock_trace_data.return_value = {
            "trace": [0.1, 0.2],
            "idx_neuron": 1,
            "dataset_id": "demo",
        }
        request = self.factory.get("/activity/api/data/demo/1/")

        response = get_neural_trace(request, "demo", 1)

        self.assertEqual(response.status_code, 200)
        body = json.loads(response.content)
        self.assertEqual(body["dataset_id"], "demo")

    @patch("activity.views.get_neural_trace_data", return_value=None)
    def test_get_neural_trace_returns_404_for_missing(self, mock_trace_data):
        request = self.factory.get("/activity/api/data/demo/999/")
        with self.assertRaises(Http404):
            get_neural_trace(request, "demo", 999)

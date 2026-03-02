import json
from unittest.mock import patch

import numpy as np
from django.http import Http404
from django.test import RequestFactory, SimpleTestCase

from activity.views import (
    ACTIVITY_REPLAY_BEHAVIOR_CORR_CACHE_KEY_PREFIX,
    ACTIVITY_REPLAY_CONNECTOME_DEGREE_CACHE_KEY,
    _compute_activity_behavior_correlation_index,
    _compute_connectome_full_degree_index,
    _get_activity_behavior_correlation_index,
    _get_connectome_full_degree_index,
    get_neural_trace,
    get_signal_replay_data,
    plot_multiple_data,
)


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


class SignalReplayViewTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def test_get_signal_replay_data_requires_dataset_params(self):
        request = self.factory.get("/activity/api/data/replay/")
        response = get_signal_replay_data(request)
        self.assertEqual(response.status_code, 400)

    def test_get_signal_replay_data_rejects_invalid_integer_params(self):
        request = self.factory.get(
            "/activity/api/data/replay/",
            data={
                "activity_dataset": "demo-a",
                "connectome_dataset": "demo-c",
                "min_synapse_chemical": "bad-int",
            },
        )
        response = get_signal_replay_data(request)
        self.assertEqual(response.status_code, 400)

    @patch("activity.views.cache.set")
    @patch("activity.views.cache.get", return_value=None)
    @patch("activity.views._build_signal_replay_payload")
    def test_get_signal_replay_data_returns_payload(
        self,
        mock_build_payload,
        mock_cache_get,
        mock_cache_set,
    ):
        mock_build_payload.return_value = {
            "status": "ok",
            "meta": {"trace_length": 3, "n_nodes": 2, "n_edges": 1},
            "warnings": [],
            "nodes": [{"id": "AVA", "trace": [0.1, 0.2, 0.3], "degree_out": 1.0}],
            "edges": [{"source": "AVA", "target": "AVB", "weight": 2.0}],
            "timeline": {
                "time_minutes": [0.0, 0.5, 1.0],
                "global_signal": [0.1, 0.2, 0.3],
            },
        }

        request = self.factory.get(
            "/activity/api/data/replay/",
            data={
                "activity_dataset": "activity-demo",
                "connectome_dataset": "connectome-demo",
                "include_electrical": "1",
                "min_synapse_chemical": "2",
                "min_synapse_electrical": "3",
            },
        )

        response = get_signal_replay_data(request)
        self.assertEqual(response.status_code, 200)
        body = json.loads(response.content)
        self.assertEqual(body["status"], "ok")
        mock_build_payload.assert_called_once()
        mock_cache_set.assert_called_once()


class ConnectomeDegreeIndexTests(SimpleTestCase):
    @patch("activity.views.get_edge_response_data")
    @patch("activity.views.ConnectomeDataset.objects.values_list")
    def test_compute_connectome_full_degree_index_uses_full_graph(
        self,
        mock_connectome_values_list,
        mock_get_edge_response_data,
    ):
        mock_connectome_values_list.return_value = [
            ("conn-a", "A"),
            ("conn-a", "B"),
            ("conn-a", "C"),
            ("conn-a", "Z"),
            ("conn-b", "X"),
            ("conn-b", "Y"),
        ]
        mock_get_edge_response_data.side_effect = lambda data: {
            "synapses": {
                "conn-a": [
                    {"pre": "A", "post": "B", "type": "c", "count": 2},
                    {"pre": "B", "post": "C", "type": "e", "count": 3},
                    {"pre": "A", "post": "C", "type": "c", "count": 1},
                ],
                "conn-b": [
                    {"pre": "X", "post": "Y", "type": "e", "count": 4},
                ],
            }.get(data["datasets"][0], [])
        }

        index = _compute_connectome_full_degree_index()

        self.assertEqual(mock_get_edge_response_data.call_count, 2)
        mock_get_edge_response_data.assert_any_call(
            {
                "datasets": ["conn-a"],
                "neurons": ["A", "B", "C", "Z"],
                "classes": [],
                "show_individual_neuron": True,
                "show_connected_neuron": True,
            }
        )
        mock_get_edge_response_data.assert_any_call(
            {
                "datasets": ["conn-b"],
                "neurons": ["X", "Y"],
                "classes": [],
                "show_individual_neuron": True,
                "show_connected_neuron": True,
            }
        )

        self.assertAlmostEqual(index["conn-a"]["A"]["degree_in_full"], 0.0)
        self.assertAlmostEqual(index["conn-a"]["A"]["degree_out_full"], 3.0)
        self.assertAlmostEqual(index["conn-a"]["A"]["degree_total_full"], 3.0)

        self.assertAlmostEqual(index["conn-a"]["B"]["degree_in_full"], 5.0)
        self.assertAlmostEqual(index["conn-a"]["B"]["degree_out_full"], 3.0)
        self.assertAlmostEqual(index["conn-a"]["B"]["degree_total_full"], 8.0)

        self.assertAlmostEqual(index["conn-a"]["C"]["degree_in_full"], 4.0)
        self.assertAlmostEqual(index["conn-a"]["C"]["degree_out_full"], 3.0)
        self.assertAlmostEqual(index["conn-a"]["C"]["degree_total_full"], 7.0)

        # Included from available_neurons list even with no incident edges.
        self.assertAlmostEqual(index["conn-a"]["Z"]["degree_in_full"], 0.0)
        self.assertAlmostEqual(index["conn-a"]["Z"]["degree_out_full"], 0.0)
        self.assertAlmostEqual(index["conn-a"]["Z"]["degree_total_full"], 0.0)

        # Electrical synapses contribute bidirectionally.
        self.assertAlmostEqual(index["conn-b"]["X"]["degree_in_full"], 4.0)
        self.assertAlmostEqual(index["conn-b"]["X"]["degree_out_full"], 4.0)
        self.assertAlmostEqual(index["conn-b"]["Y"]["degree_in_full"], 4.0)
        self.assertAlmostEqual(index["conn-b"]["Y"]["degree_out_full"], 4.0)
        self.assertGreaterEqual(index["conn-a"]["A"]["pagerank_centrality"], 0.0)
        self.assertGreaterEqual(index["conn-a"]["A"]["eigenvector_centrality"], 0.0)

    @patch("activity.views.cache.set")
    @patch("activity.views._compute_connectome_full_degree_index")
    @patch("activity.views.cache.get")
    def test_get_connectome_full_degree_index_cache_miss_sets_cache(
        self,
        mock_cache_get,
        mock_compute_degree_index,
        mock_cache_set,
    ):
        mock_cache_get.return_value = None
        mock_compute_degree_index.return_value = {"conn-a": {"A": {"degree_total_full": 1.0}}}

        result = _get_connectome_full_degree_index()

        self.assertEqual(result, {"conn-a": {"A": {"degree_total_full": 1.0}}})
        mock_compute_degree_index.assert_called_once()
        mock_cache_set.assert_called_once()
        cache_set_args, cache_set_kwargs = mock_cache_set.call_args
        self.assertEqual(cache_set_args[0], ACTIVITY_REPLAY_CONNECTOME_DEGREE_CACHE_KEY)
        self.assertEqual(cache_set_args[1], result)
        self.assertIn("timeout", cache_set_kwargs)

    @patch("activity.views.cache.set")
    @patch("activity.views._compute_connectome_full_degree_index")
    @patch("activity.views.cache.get")
    def test_get_connectome_full_degree_index_cache_hit_skips_compute(
        self,
        mock_cache_get,
        mock_compute_degree_index,
        mock_cache_set,
    ):
        cached = {"conn-cached": {"N": {"degree_total_full": 2.0}}}
        mock_cache_get.return_value = cached

        result = _get_connectome_full_degree_index()

        self.assertEqual(result, cached)
        mock_compute_degree_index.assert_not_called()
        mock_cache_set.assert_not_called()


class BehaviorCorrelationIndexTests(SimpleTestCase):
    @patch("activity.views._aggregate_replay_traces")
    @patch("activity.views._extract_behavior_arrays")
    def test_compute_activity_behavior_correlation_index(self, mock_extract_behavior, mock_aggregate):
        mock_aggregate.return_value = {
            "A": {"trace": [0.0, 1.0, 2.0, 3.0]},
            "B": {"trace": [3.0, 2.0, 1.0, 0.0]},
        }
        mock_extract_behavior.return_value = {
            "v": np.asarray([0.0, 1.0, 2.0, 3.0], dtype=float),
            "turn": np.asarray([3.0, 2.0, 1.0, 0.0], dtype=float),
        }

        class DatasetStub:
            dataset_id = "activity-demo"

        output = _compute_activity_behavior_correlation_index(DatasetStub())
        self.assertIn("A", output)
        self.assertIn("B", output)
        self.assertIn("v", output["A"])
        self.assertIn("turn", output["A"])
        self.assertGreater(output["A"]["v"], 0.9)
        self.assertLess(output["A"]["turn"], -0.9)

    @patch("activity.views.cache.set")
    @patch("activity.views._compute_activity_behavior_correlation_index")
    @patch("activity.views.cache.get")
    def test_get_activity_behavior_correlation_index_cache_miss_sets_cache(
        self,
        mock_cache_get,
        mock_compute_index,
        mock_cache_set,
    ):
        mock_cache_get.return_value = None
        mock_compute_index.return_value = {"A": {"v": 0.5}}

        class DatasetStub:
            dataset_id = "activity-demo"

        result = _get_activity_behavior_correlation_index(DatasetStub())
        self.assertEqual(result, {"A": {"v": 0.5}})
        mock_compute_index.assert_called_once()
        mock_cache_set.assert_called_once()
        cache_set_args, _ = mock_cache_set.call_args
        self.assertEqual(
            cache_set_args[0],
            f"{ACTIVITY_REPLAY_BEHAVIOR_CORR_CACHE_KEY_PREFIX}activity-demo",
        )
        self.assertEqual(cache_set_args[1], {"A": {"v": 0.5}})

    @patch("activity.views.cache.set")
    @patch("activity.views._compute_activity_behavior_correlation_index")
    @patch("activity.views.cache.get")
    def test_get_activity_behavior_correlation_index_cache_hit_skips_compute(
        self,
        mock_cache_get,
        mock_compute_index,
        mock_cache_set,
    ):
        mock_cache_get.return_value = {"A": {"v": 0.7}}

        class DatasetStub:
            dataset_id = "activity-demo"

        result = _get_activity_behavior_correlation_index(DatasetStub())
        self.assertEqual(result, {"A": {"v": 0.7}})
        mock_compute_index.assert_not_called()
        mock_cache_set.assert_not_called()

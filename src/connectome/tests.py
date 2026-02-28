import json
from unittest.mock import patch

import networkx as nx
from django.test import RequestFactory, SimpleTestCase

import connectome.graph_data
from connectome.views import find_paths, get_edges


def _empty_response():
    return {"datasets": [], "neurons": [], "synapses": []}


class GetEdgesViewTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def test_get_edges_rejects_non_post(self):
        request = self.factory.get("/connectome/api/get-edges/")
        response = get_edges(request)
        self.assertEqual(response.status_code, 405)

    def test_get_edges_rejects_invalid_payload(self):
        payload = {"datasets": [], "neurons": [], "classes": []}
        request = self.factory.post(
            "/connectome/api/get-edges/",
            data=json.dumps(payload),
            content_type="application/json",
        )

        response = get_edges(request)
        self.assertEqual(response.status_code, 400)

    @patch("connectome.views.get_edge_response_data")
    def test_get_edges_accepts_valid_payload(self, mock_get_edge_response_data):
        mock_get_edge_response_data.return_value = _empty_response()

        payload = {
            "datasets": ["witvliet_2020_8", "witvliet_2020_8"],
            "neurons": ["AVA", "AVA"],
            "classes": [],
            "show_individual_neuron": True,
            "show_connected_neuron": False,
        }
        request = self.factory.post(
            "/connectome/api/get-edges/",
            data=json.dumps(payload),
            content_type="application/json",
        )

        response = get_edges(request)
        self.assertEqual(response.status_code, 200)
        mock_get_edge_response_data.assert_called_once_with(
            {
                "datasets": ["witvliet_2020_8"],
                "neurons": ["AVA"],
                "classes": [],
                "show_individual_neuron": True,
                "show_connected_neuron": False,
            }
        )


class FindPathsViewTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def test_find_paths_rejects_non_get(self):
        request = self.factory.post("/connectome/api/find-paths/")
        response = find_paths(request)
        self.assertEqual(response.status_code, 405)

    def test_find_paths_returns_shortest_path_payload(self):
        graph = nx.DiGraph()
        graph.add_edge("A", "B", weight=3, synapse_type="c")
        graph_objects = {
            "demo": {
                "neuron": {"all": graph, "chemical_only": graph},
                "class": {"all": graph, "chemical_only": graph},
            }
        }

        with patch.object(connectome.graph_data, "GRAPH_OBJECTS", graph_objects):
            request = self.factory.get(
                "/connectome/api/find-paths/",
                data={"dataset": "demo", "start": "A", "end": "B"},
            )
            response = find_paths(request)

        self.assertEqual(response.status_code, 200)
        body = json.loads(response.content)
        self.assertEqual(body["dataset_id"], "demo")
        self.assertEqual(body["paths"][0]["path"], ["A", "B"])

    def test_find_paths_rejects_unknown_dataset(self):
        graph_objects = {
            "demo": {
                "neuron": {"all": nx.DiGraph(), "chemical_only": nx.DiGraph()},
                "class": {"all": nx.DiGraph(), "chemical_only": nx.DiGraph()},
            }
        }

        with patch.object(connectome.graph_data, "GRAPH_OBJECTS", graph_objects):
            request = self.factory.get(
                "/connectome/api/find-paths/",
                data={"dataset": "unknown", "start": "A", "end": "B"},
            )
            response = find_paths(request)

        self.assertEqual(response.status_code, 400)

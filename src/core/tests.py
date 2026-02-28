from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase

from core.views import is_healthy, robots_txt


class CoreViewsTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    @patch("core.views.connection.ensure_connection")
    def test_is_healthy_returns_ok(self, mock_ensure_connection):
        request = self.factory.get("/is_healthy/")
        response = is_healthy(request)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content.decode("utf-8"), "OK")

    @patch("core.views.connection.ensure_connection", side_effect=Exception("db unavailable"))
    def test_is_healthy_returns_error_on_failure(self, mock_ensure_connection):
        request = self.factory.get("/is_healthy/")
        response = is_healthy(request)
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.content.decode("utf-8"), "ERROR")

    def test_robots_txt_allows_get(self):
        request = self.factory.get("/robots.txt")
        response = robots_txt(request)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "text/plain")

    def test_robots_txt_rejects_post(self):
        request = self.factory.post("/robots.txt")
        response = robots_txt(request)
        self.assertEqual(response.status_code, 405)

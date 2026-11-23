import json
import os
import tempfile
import unittest
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from threading import Thread

from altarray import server


class AltarrayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        server.DB_PATH = os.path.join(cls.temp.name, "test.db")
        server.initialize()
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.thread = Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.port = cls.httpd.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.temp.cleanup()

    def request(self, method, path, body=None, cookie=None):
        conn = HTTPConnection("127.0.0.1", self.port)
        headers = {"Content-Type": "application/json"}
        if cookie:
            headers["Cookie"] = cookie
        encoded = json.dumps(body).encode() if body is not None else None
        conn.request(method, path, body=encoded, headers=headers)
        response = conn.getresponse()
        content = response.read()
        return response.status, response.getheader("Set-Cookie"), json.loads(content) if content else None

    def login(self, role):
        status, cookie, data = self.request("POST", "/api/session", {"role": role})
        self.assertEqual(status, 200)
        return cookie.split(";", 1)[0]

    def test_api_requires_session(self):
        status, _, data = self.request("GET", "/api/customers")
        self.assertEqual(status, 401)
        self.assertIn("Sign in", data["error"])

    def test_dispatcher_can_create_customer_and_job(self):
        cookie = self.login("dispatcher")
        status, _, customer = self.request("POST", "/api/customers", {"name": "Taylor Morgan"}, cookie)
        self.assertEqual(status, 201)
        status, _, job = self.request("POST", "/api/jobs", {"title": "Heat pump inspection", "customer_id": customer["id"], "scheduled_for": "2026-11-25", "technician": "Alex Rivera"}, cookie)
        self.assertEqual(status, 201)
        self.assertEqual(job["title"], "Heat pump inspection")

    def test_technician_cannot_access_finance(self):
        cookie = self.login("technician")
        status, _, data = self.request("GET", "/api/invoices", cookie=cookie)
        self.assertEqual(status, 403)
        self.assertIn("cannot view", data["error"])
        status, _, data = self.request("POST", "/api/invoices", {"customer_id": 1, "amount": 10}, cookie)
        self.assertEqual(status, 403)

    def test_technician_only_sees_assigned_jobs(self):
        cookie = self.login("technician")
        status, _, jobs = self.request("GET", "/api/jobs", cookie=cookie)
        self.assertEqual(status, 200)
        self.assertTrue(all(job["technician"] == "Alex Rivera" for job in jobs))

    def test_office_can_create_estimate_and_update_status(self):
        cookie = self.login("office")
        status, _, estimate = self.request("POST", "/api/estimates", {"customer_id": 1, "description": "Annual service", "amount": 450.126, "status": "Draft"}, cookie)
        self.assertEqual(status, 201)
        self.assertEqual(estimate["amount"], 450.13)
        status, _, updated = self.request("PATCH", f"/api/estimates/{estimate['id']}", {"status": "Sent"}, cookie)
        self.assertEqual(status, 200)
        self.assertEqual(updated["status"], "Sent")

    def test_invalid_status_and_amount_rejected(self):
        cookie = self.login("admin")
        status, _, _ = self.request("POST", "/api/invoices", {"customer_id": 1, "amount": -4}, cookie)
        self.assertEqual(status, 400)
        status, _, data = self.request("PATCH", "/api/jobs/1", {"status": "Dispatched-ish"}, cookie)
        self.assertEqual(status, 400)
        self.assertIn("status", data["error"])


if __name__ == "__main__":
    unittest.main()

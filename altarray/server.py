from __future__ import annotations

import json
import os
import secrets
import sqlite3
from contextlib import contextmanager
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "static"
DB_PATH = os.environ.get("ALTARRAY_DB", "altarray.db")
ROLES = {"admin", "dispatcher", "technician", "office"}
PERMISSIONS = {
    "admin": {"customers": {"read", "write"}, "jobs": {"read", "write"}, "estimates": {"read", "write"}, "invoices": {"read", "write"}},
    "dispatcher": {"customers": {"read", "write"}, "jobs": {"read", "write"}, "estimates": {"read"}, "invoices": {"read"}},
    "technician": {"customers": {"read"}, "jobs": {"read", "write"}, "estimates": set(), "invoices": set()},
    "office": {"customers": {"read", "write"}, "jobs": {"read"}, "estimates": {"read", "write"}, "invoices": {"read", "write"}},
}
FIELDS = {
    "customers": {"name", "phone", "email", "address", "notes"},
    "jobs": {"title", "customer_id", "technician", "scheduled_for", "window", "status", "priority", "notes"},
    "estimates": {"customer_id", "job_id", "description", "amount", "status", "valid_until"},
    "invoices": {"customer_id", "job_id", "amount", "status", "due_date"},
}
sessions: dict[str, str] = {}


def connect():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    return db


@contextmanager
def database():
    db = connect()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def initialize():
    with database() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS customers (
            id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT DEFAULT '', email TEXT DEFAULT '', address TEXT DEFAULT '', notes TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS jobs (
            id INTEGER PRIMARY KEY, title TEXT NOT NULL, customer_id INTEGER NOT NULL REFERENCES customers(id), technician TEXT DEFAULT '', scheduled_for TEXT DEFAULT '', window TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'Scheduled', priority TEXT NOT NULL DEFAULT 'Normal', notes TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS estimates (
            id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), job_id INTEGER REFERENCES jobs(id), description TEXT NOT NULL, amount REAL NOT NULL, status TEXT NOT NULL DEFAULT 'Draft', valid_until TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS invoices (
            id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), job_id INTEGER REFERENCES jobs(id), amount REAL NOT NULL, status TEXT NOT NULL DEFAULT 'Unpaid', due_date TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        """)
        if db.execute("SELECT COUNT(*) FROM customers").fetchone()[0] == 0:
            db.execute("INSERT INTO customers(name, phone, email, address, notes) VALUES(?,?,?,?,?)", ("Morgan Lee", "(416) 555-0184", "morgan@example.test", "18 Cedar Lane, Toronto", "Prefers morning visits"))
            db.execute("INSERT INTO customers(name, phone, email, address) VALUES(?,?,?,?)", ("Jamie Chen", "(647) 555-0142", "jamie@example.test", "202 Bay Street, Toronto"))
            db.execute("INSERT INTO jobs(title, customer_id, technician, scheduled_for, window, status, priority) VALUES(?,?,?,?,?,?,?)", ("Furnace tune-up", 1, "Alex Rivera", "2026-11-24", "9:00–11:00", "Scheduled", "High"))
            db.execute("INSERT INTO estimates(customer_id, job_id, description, amount, status, valid_until) VALUES(?,?,?,?,?,?)", (1, 1, "Seasonal service package", 389.00, "Sent", "2026-12-01"))
            db.execute("INSERT INTO invoices(customer_id, job_id, amount, status, due_date) VALUES(?,?,?,?,?)", (2, None, 245.00, "Unpaid", "2026-12-05"))


def encode(row):
    return dict(row)


class Handler(BaseHTTPRequestHandler):
    server_version = "Altarray/0.1"

    def log_message(self, fmt, *args):
        return

    def send_json(self, status, value):
        payload = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def body(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length > 32_000:
            raise ValueError("Request body is too large")
        return json.loads(self.rfile.read(length) or b"{}")

    def role(self):
        cookie = SimpleCookie(self.headers.get("Cookie", ""))
        token = cookie.get("altarray_session")
        return sessions.get(token.value) if token else None

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/" or path.startswith("/static/"):
            filename = "index.html" if path == "/" else unquote(path.removeprefix("/static/"))
            target = (STATIC / filename).resolve()
            if STATIC.resolve() not in target.parents or not target.is_file():
                return self.send_error(404)
            data = target.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8" if target.suffix == ".html" else "text/css; charset=utf-8" if target.suffix == ".css" else "text/javascript; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            return self.wfile.write(data)
        if path == "/api/session":
            return self.send_json(200, {"role": self.role()})
        role = self.role()
        pieces = path.strip("/").split("/")
        if len(pieces) == 2 and pieces[0] == "api" and pieces[1] in FIELDS:
            resource = pieces[1]
            if not role:
                return self.send_json(401, {"error": "Sign in required"})
            if "read" not in PERMISSIONS[role][resource]:
                return self.send_json(403, {"error": "Your role cannot view this section"})
            with database() as db:
                if role == "technician" and resource == "jobs":
                    rows = db.execute("SELECT * FROM jobs WHERE technician=? ORDER BY scheduled_for, window", ("Alex Rivera",)).fetchall()
                else:
                    rows = db.execute(f"SELECT * FROM {resource} ORDER BY id DESC").fetchall()
            return self.send_json(200, [encode(row) for row in rows])
        return self.send_json(404, {"error": "Not found"})

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/session":
            try:
                role = self.body().get("role")
            except (ValueError, json.JSONDecodeError):
                return self.send_json(400, {"error": "Invalid request"})
            if role not in ROLES:
                return self.send_json(400, {"error": "Choose a valid demo role"})
            token = secrets.token_urlsafe(32)
            sessions[token] = role
            payload = json.dumps({"role": role}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Set-Cookie", f"altarray_session={token}; HttpOnly; SameSite=Strict; Path=/")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            return self.wfile.write(payload)
        if path == "/api/logout":
            cookie = SimpleCookie(self.headers.get("Cookie", ""))
            token = cookie.get("altarray_session")
            if token:
                sessions.pop(token.value, None)
            self.send_response(204)
            self.send_header("Set-Cookie", "altarray_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0")
            self.end_headers()
            return
        if path.startswith("/api/estimates/") and path.endswith("/invoice"):
            role = self.role()
            if not role:
                return self.send_json(401, {"error": "Sign in required"})
            if "write" not in PERMISSIONS[role]["invoices"] or "write" not in PERMISSIONS[role]["estimates"]:
                return self.send_json(403, {"error": "Your role cannot create invoices from estimates"})
            try:
                estimate_id = int(path.split("/")[3])
                data = self.body()
                with database() as db:
                    estimate = db.execute("SELECT * FROM estimates WHERE id=?", (estimate_id,)).fetchone()
                    if not estimate:
                        return self.send_json(404, {"error": "Estimate not found"})
                    if estimate["status"] != "Approved":
                        return self.send_json(400, {"error": "Only approved estimates can become invoices"})
                    cur = db.execute("INSERT INTO invoices(customer_id, job_id, amount, status, due_date) VALUES(?,?,?,?,?)", (estimate["customer_id"], estimate["job_id"], estimate["amount"], "Unpaid", data.get("due_date", "")))
                    db.execute("UPDATE estimates SET status='Invoiced' WHERE id=?", (estimate_id,))
                    invoice = db.execute("SELECT * FROM invoices WHERE id=?", (cur.lastrowid,)).fetchone()
                return self.send_json(201, encode(invoice))
            except (ValueError, sqlite3.IntegrityError, json.JSONDecodeError) as exc:
                return self.send_json(400, {"error": str(exc) or "Invalid estimate"})
        pieces = path.strip("/").split("/")
        if len(pieces) != 2 or pieces[0] != "api" or pieces[1] not in FIELDS:
            return self.send_json(404, {"error": "Not found"})
        resource = pieces[1]
        role = self.role()
        if not role:
            return self.send_json(401, {"error": "Sign in required"})
        if "write" not in PERMISSIONS[role][resource]:
            return self.send_json(403, {"error": "Your role cannot make changes here"})
        try:
            data = self.body()
            data = {k: v for k, v in data.items() if k in FIELDS[resource]}
            self.validate(resource, data, creating=True)
            columns = list(data)
            with database() as db:
                cur = db.execute(f"INSERT INTO {resource} ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)})", [data[k] for k in columns])
                row = db.execute(f"SELECT * FROM {resource} WHERE id=?", (cur.lastrowid,)).fetchone()
            return self.send_json(201, encode(row))
        except (ValueError, sqlite3.IntegrityError, json.JSONDecodeError) as exc:
            return self.send_json(400, {"error": str(exc) or "Invalid record"})

    def do_PATCH(self):
        pieces = urlparse(self.path).path.strip("/").split("/")
        if len(pieces) != 3 or pieces[0] != "api" or pieces[1] not in FIELDS:
            return self.send_json(404, {"error": "Not found"})
        resource, record_id = pieces[1], pieces[2]
        role = self.role()
        if not role:
            return self.send_json(401, {"error": "Sign in required"})
        if "write" not in PERMISSIONS[role][resource]:
            return self.send_json(403, {"error": "Your role cannot make changes here"})
        try:
            data = self.body()
            data = {k: v for k, v in data.items() if k in FIELDS[resource]}
            self.validate(resource, data, creating=False)
            if not data:
                return self.send_json(400, {"error": "No supported fields provided"})
            with database() as db:
                where = "id=? AND technician=?" if role == "technician" and resource == "jobs" else "id=?"
                params = [*data.values(), int(record_id)]
                if where != "id=?":
                    params.append("Alex Rivera")
                cur = db.execute(f"UPDATE {resource} SET {','.join(k+'=?' for k in data)} WHERE {where}", params)
                if not cur.rowcount:
                    return self.send_json(404, {"error": "Record not found"})
                row = db.execute(f"SELECT * FROM {resource} WHERE id=?", (int(record_id),)).fetchone()
            return self.send_json(200, encode(row))
        except (ValueError, sqlite3.IntegrityError, json.JSONDecodeError) as exc:
            return self.send_json(400, {"error": str(exc) or "Invalid record"})

    @staticmethod
    def validate(resource, data, creating):
        required = {"customers": ("name",), "jobs": ("title", "customer_id"), "estimates": ("customer_id", "description", "amount"), "invoices": ("customer_id", "amount")}[resource]
        if creating and any(not data.get(field) for field in required):
            raise ValueError("Please fill in all required fields")
        if "amount" in data:
            try:
                amount = float(data["amount"])
            except (TypeError, ValueError):
                raise ValueError("Amount must be a number")
            if amount < 0 or amount > 10_000_000:
                raise ValueError("Amount must be between 0 and 10,000,000")
            data["amount"] = round(amount, 2)
        if resource == "jobs" and data.get("status") not in (None, "Scheduled", "In progress", "Completed", "Cancelled"):
            raise ValueError("Invalid job status")
        if resource == "estimates" and data.get("status") not in (None, "Draft", "Sent", "Approved", "Declined", "Invoiced"):
            raise ValueError("Invalid estimate status")
        if resource == "invoices" and data.get("status") not in (None, "Unpaid", "Paid", "Overdue"):
            raise ValueError("Invalid invoice status")


def main():
    global DB_PATH
    DB_PATH = os.environ.get("ALTARRAY_DB", "altarray.db")
    initialize()
    port = int(os.environ.get("ALTARRAY_PORT", "8000"))
    print(f"Altarray running at http://127.0.0.1:{port}")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()


if __name__ == "__main__":
    main()

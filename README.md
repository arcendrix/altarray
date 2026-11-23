# Altarray

Altarray is an original field-service management starter for service businesses. It includes a small, runnable vertical slice for customer records, work orders, dispatch, estimates, invoices, and role-gated API access.

## Run locally

Requires Python 3.11 or newer. No third-party packages are needed.

```powershell
python -m altarray
```

From this repository root, run `python -m unittest discover -s tests -v`. Then visit <http://127.0.0.1:8000>.

The app stores data in `altarray.db` in the current working directory. Set `ALTARRAY_DB` to choose another path and `ALTARRAY_PORT` to change the port.

## Demo access

The sign-in screen provides four demo roles: Admin, Dispatcher, Technician, and Office. This local demo login intentionally has no password and is not suitable for deployment with real data. Before production, replace it with a proper identity provider, persistent session store, CSRF protection, tenant isolation, audit logging, and production-grade secret and database management.

## Included workflows

- Create and search customers.
- Create jobs, assign technicians, and set a date and time window.
- Create estimates, calculate line totals, and change estimate status.
- Create invoices, track due dates and payment status.
- Use API-side role checks for view and write permissions.

This is a focused starter, not a complete dispatch, accounting, messaging, payments, or mobile technician system. All sample records are fictional.

## REA reference

REA was consulted only as a publicly documented inspection methodology. No ServiceTitan software, source, customer data, protected assets, or branded interface was accessed or copied. Altarray's flows and UI are independently implemented.


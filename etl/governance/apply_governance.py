"""Apply persona_rbac.sql to the workspace and print a verification report.

    python3 etl/governance/apply_governance.py --profile fe-bar            # apply + verify
    python3 etl/governance/apply_governance.py --profile fe-bar --verify   # verify only

Runs each statement through the SQL Statement Execution API (Databricks CLI, your own identity). The file is
idempotent, so rerunning is safe. A GRANT to an account group that does not exist yet is reported as SKIPPED and the
run carries on: create the group (see README) and rerun.
"""

import argparse
import json
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
TABLE = "darren_fe_bar_catalog.gold.replenishment_recommendations_current"

VERIFY = [
    ("Rows visible to me (row filter applied)", f"SELECT count(*) AS rows FROM {TABLE}"),
    (
        "Rows per persona (governance.persona_row_visible)",
        f"""SELECT p.persona_id, p.role, count_if(darren_fe_bar_catalog.governance.persona_row_visible(p.persona_id, r.region, r.location_id)) AS visible,
                  count(*) AS total, darren_fe_bar_catalog.governance.persona_sees_unit_cost(p.persona_id) AS sees_unit_cost
           FROM darren_fe_bar_catalog.governance.persona_access p CROSS JOIN {TABLE} r
           GROUP BY p.persona_id, p.role, p.sort_order ORDER BY p.sort_order""",
    ),
    (
        "Row filters",
        "SELECT table_schema, table_name, filter_name, target_columns "
        "FROM darren_fe_bar_catalog.information_schema.row_filters",
    ),
    (
        "Column masks",
        "SELECT table_schema, table_name, column_name, mask_name "
        "FROM darren_fe_bar_catalog.information_schema.column_masks",
    ),
    (
        "Grants on the Gold table",
        "SELECT grantee, privilege_type FROM darren_fe_bar_catalog.information_schema.table_privileges "
        "WHERE table_schema = 'gold' AND table_name = 'replenishment_recommendations_current' ORDER BY grantee",
    ),
]


def statements(sql: str) -> list[str]:
    out, buf = [], []
    for line in sql.splitlines():
        if not buf and (not line.strip() or line.lstrip().startswith("--")):
            continue
        buf.append(line)
        if line.rstrip().endswith(";"):
            out.append("\n".join(buf).rstrip().rstrip(";"))
            buf = []
    if buf:
        out.append("\n".join(buf))
    return out


def run(profile: str, warehouse: str, statement: str) -> dict:
    body = {"warehouse_id": warehouse, "statement": statement, "wait_timeout": "50s", "on_wait_timeout": "CONTINUE"}
    res = subprocess.run(
        ["databricks", "api", "post", "/api/2.0/sql/statements", "--profile", profile, "--json", json.dumps(body)],
        capture_output=True,
        text=True,
    )
    if res.returncode != 0:
        return {"status": {"state": "FAILED", "error": {"message": res.stderr.strip()}}}
    out = json.loads(res.stdout)
    while out.get("status", {}).get("state") in ("PENDING", "RUNNING"):
        res = subprocess.run(
            ["databricks", "api", "get", f"/api/2.0/sql/statements/{out['statement_id']}", "--profile", profile],
            capture_output=True,
            text=True,
        )
        out = json.loads(res.stdout)
    return out


def rows(out: dict) -> list[dict]:
    cols = [c["name"] for c in out.get("manifest", {}).get("schema", {}).get("columns", [])]
    return [dict(zip(cols, r)) for r in out.get("result", {}).get("data_array", []) or []]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--profile", required=True)
    ap.add_argument("--warehouse", default="221da0ceb437f8a8")
    ap.add_argument("--verify", action="store_true", help="only print the verification report")
    args = ap.parse_args()

    failed = 0
    if not args.verify:
        for stmt in statements((HERE / "persona_rbac.sql").read_text()):
            head = " ".join(stmt.split())[:110]
            out = run(args.profile, args.warehouse, stmt)
            state = out.get("status", {}).get("state")
            msg = out.get("status", {}).get("error", {}).get("message", "")
            if state == "SUCCEEDED":
                print(f"OK       {head}")
            elif "PRINCIPAL_DOES_NOT_EXIST" in msg or "Could not find principal" in msg:
                print(f"SKIPPED  {head}\n         principal does not exist yet (create the account group, then rerun)")
            else:
                failed += 1
                print(f"FAILED   {head}\n         {msg[:400]}")

    for title, sql in VERIFY:
        out = run(args.profile, args.warehouse, sql)
        print(f"\n== {title}")
        if out.get("status", {}).get("state") != "SUCCEEDED":
            print("  error:", out.get("status", {}).get("error", {}).get("message", "")[:400])
            continue
        for r in rows(out):
            print("  " + json.dumps(r))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

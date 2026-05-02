from backend.relational_mirror import TABLE_SPECS
import inspect
from backend import relational_mirror

for key, spec in TABLE_SPECS.items():
    col_count = len(spec["columns"])
    # We can't easily get the count from _normalize_row without calling it
    # But we can try to call it with a dummy dict
    try:
        row = relational_mirror._normalize_row(key, {"id": "dummy"})
        param_count = len(row)
        if col_count != param_count:
            print(f"Mismatch in {key}: Columns={col_count}, Parameters={param_count}")
        else:
            print(f"Match in {key}: {col_count}")
    except Exception as e:
        print(f"Error checking {key}: {e}")

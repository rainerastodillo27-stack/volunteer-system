import sys
import os
sys.path.insert(0, os.path.abspath('.'))

from backend.api import get_connection

with get_connection() as conn:
    with conn.cursor() as cur:
        cur.execute("""
            SELECT table_name, column_name 
            FROM information_schema.columns 
            WHERE table_schema = 'public' AND data_type IN ('text', 'character varying', 'json', 'jsonb');
        """)
        cols = cur.fetchall()
        for t, c in cols:
            try:
                cur.execute(f'SELECT count(*) FROM public.{t} WHERE "{c}"::text ILIKE %s', ('%elena%',))
                cnt = cur.fetchone()[0]
                if cnt > 0:
                    print(f'Match in {t}.{c}: {cnt} rows')
                    cur.execute(f'SELECT "{c}"::text FROM public.{t} WHERE "{c}"::text ILIKE %s LIMIT 3', ('%elena%',))
                    for row in cur.fetchall():
                        print('  sample:', row[0][:200])
            except Exception as e:
                conn.rollback()

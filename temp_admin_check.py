from backend.db import get_postgres_connection


connection = get_postgres_connection()
try:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            select users_id, email, name, role
            from public.users
            where lower(email) = 'nvc4090@gmail.com'
            """
        )
        rows = cursor.fetchall()
        print("MATCHED_ADMIN_ACCOUNT")
        for user_id, email, name, role in rows:
            print({"users_id": user_id, "email": email, "name": name, "role": role})
finally:
    connection.close()

# Volcre Simple System Diagram

## Simple Diagram

```mermaid
flowchart TD
    U[Users<br/>Admin / Volunteer / Partner]
    A[Volcre App<br/>Expo React Native]
    B[Backend API<br/>FastAPI]
    C[(Database<br/>Postgres)]
    D[Google Maps]

    U --> A
    A --> B
    B --> C
    A --> D
```

## Very Easy Drawing

```text
 +----------------------+
 |        USERS         |
 | Admin Volunteer      |
 | Partner              |
 +----------+-----------+
            |
            v
 +----------------------+
 |      VOLCRE APP      |
 |  Mobile / Web UI     |
 +----------+-----------+
            |
            v
 +----------------------+
 |     BACKEND API      |
 |       FastAPI        |
 +----------+-----------+
            |
            v
 +----------------------+
 |      DATABASE        |
 |      Postgres        |
 +----------------------+

 Volcre App ---> Google Maps
```

## Short Explanation

- Users use the Volcre app.
- The app sends data requests to the backend API.
- The backend API reads and writes data in the database.
- The app also connects to Google Maps for map features.


# 📨 Notification Service

A **modular and extensible notification system** supporting multiple channels (Email, SMS, Push).
Built with **Node.js, TypeScript, PostgreSQL, Redis**, and **Docker** — designed for **scalability, reliability, and clean architecture**.

---

## 🧩 Components

| Layer             | Description                                                         |
| ----------------- | ------------------------------------------------------------------- |
| **API Layer**     | Validates requests, checks idempotency, and queues jobs.            |
| **Queue Layer**   | Redis + BullMQ for reliable job persistence.                        |
| **Worker Layer**  | Background processes that send notifications asynchronously.        |
| **Channel Layer** | Strategy pattern for different delivery methods (Email, SMS, Push). |

---

## 🚀 Installation

**Requirements**:

* Docker 20.10+
* Docker Compose 2.0+

---

### 1. Clone Repository

```bash
git clone https://github.com/miriamsm/notification-service
cd notification-service
```

### 2. Configure Environment

```bash
# Copy example environment file
cp .env.example .env

# Edit variables if needed (defaults work for Docker)
nano .env
```

> **Important `.env` variables**:
>
> * `POSTGRES_USER`
> * `POSTGRES_PASSWORD`
> * `POSTGRES_DB`
> * `REDIS_HOST`
> * `REDIS_PORT`
> * `API_PORT`

---

### 3. Start All Services (Docker)

```bash
# Build and start all containers
docker-compose up --build

# Or run in background
docker-compose up -d --build
```

**What this does**:

1. Builds Docker images for API and Worker
2. Starts PostgreSQL and Redis
3. Runs database migration
4. Starts API server (default port 3000)
5. Starts Worker processes

---

### 4. Verify Services

```bash
# Check container status
docker-compose ps

# Check API health
curl http://localhost:3000/api/notifications/health
```

**Expected output**:

```
NAME                         STATUS
notification_api             Up (healthy)
notification_worker          Up
notification_db              Up (healthy)
notification_redis           Up (healthy)
notification_migration       Exited (0)
```

### 5. View Logs & Test Notification

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f api
docker-compose logs -f worker
```

After viewing logs, you can **test creating a notification** using `curl`:

```bash
curl -X POST http://localhost:3000/api/notifications \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "123",
    "channel": "email",
    "template": "welcome_email",
    "data": {
      "name": "John Doe",
      "app_name": "MyApp",
      "link": "https://example.com"
    }
  }'
```

Once a notification is created, you can:

#### Check notification status

```bash
curl http://localhost:3000/api/notifications/<notification_id>
```

> Replace `<notification_id>` with the ID returned by the POST request.

#### Check queue statistics

```bash
curl http://localhost:3000/api/notifications/stats/queue
```

> This shows the number of jobs waiting, active, completed, and failed in the queue.

---

### 6. Stop Services

```bash
# Stop containers (keep data)
docker-compose stop

# Stop and remove containers (keep data)
docker-compose down

# Stop and remove everything (including data)
docker-compose down -v
```

---

### 7. Run Worker (Local Development)

```bash
npm run dev:worker
```

> Processes queued notifications asynchronously.

---

## 📡 API Endpoints

| Method | Endpoint                                         | Description                  |
| ------ | ------------------------------------------------ | ---------------------------- |
| POST   | `/api/notifications`                             | Create a notification        |
| GET    | `/api/notifications/:id`                         | Get status of a notification |
| GET    | `/api/notifications/user/:userId?limit=&offset=` | Get notifications for a user |
| GET    | `/api/notifications/stats/queue`                 | Get queue statistics         |

**Example: Create Notification**

```json
POST /api/notifications
Content-Type: application/json

{
  "user_id": "123",
  "channel": "email",
  "template": "welcome_email",
  "data": {
    "name": "John Doe",
    "link": "https://example.com"
  }
}
```

---

## 🧠 Major Design Decisions

* **Queue-Based Processing** — Decouples API from delivery for reliability and scalability.
* **Strategy Pattern** — Easily add new channels without changing core logic.
* **Idempotency** — Redis + PostgreSQL ensure no duplicate deliveries.
* **Separate Tables** — Delivery logs are separated from notifications for performance.
* **Template System** — Update notification templates without redeploying code.

---

## 💡 Planned Improvements

* **Webhooks** — Notify clients when notifications succeed or fail
* **Batch Operations** — Send multiple notifications in a single request
* **Multi-language Support** — Add i18n for templates
* **Scheduled Notifications** — Send messages at specific times
* **Dead Letter Queue UI** — Admin panel for failed notifications

---

## ⚡ Quick Links

* **API Base URL**: `http://localhost:3000`
* **Health Check**: `/api/notifications/health`
* **Docker Compose**: `docker-compose.yml`

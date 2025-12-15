# Vyomanaut🚀

> The Problem: Data centres consume 1-3% of global electricity and are expanding rapidly & advancements in AI are all set to increase these figures. Meanwhile, billions of devices sit idle with unused storage.
> 

So..

<aside>
💡

What if we could turn every phone and laptop into part of the cloud? Vyomanaut lets users rent their device storage to companies and earn money—democratizing cloud infrastructure while reducing environmental impact.

</aside>

Two ways to look at it:

1. Opportunity to earn in exchange for free space 
2. Companies to spend a lot less on Cloud Infrastructure

A little less strain on the environment


# 📄Pre-start Research

- Questions
    
    **Q: "How is this different from Storj?"**
    
    **A:** "Storj targets crypto users and requires technical setup. Vyomanaut is for mainstream users—one-tap install, earn in regular currency. We're also India-first, targeting the 700M smartphone market here."
    
    **Q: "What about security? What if someone hacks a device?"**
    
    **A:** "Data is AES-256 encrypted before leaving our servers. Devices only store encrypted chunks. Without the key, it's useless. Even we can't decrypt it—only the company can."
    
    **Q: "Why would companies trust this?"**
    
    **A:** "We're targeting low-priority data where speed doesn't matter—backups, archives, cold storage. For critical data, they'll still use AWS. But for archival, paying $1/TB instead of $5/TB is compelling."
    
    **Q: "How do you prevent fraud?"**
    
    **A:** "We verify storage with cryptographic proofs. Devices must prove they're storing data by quickly returning random chunks. If they fail, they're removed and don't earn."
    
    **Q: "What's your business model?"**
    
    **A:** "Companies pay $3/TB, we pay users $1.50/TB, we keep $1.50/TB. At 10,000TB stored, that's $15K/month revenue."


# Tech Stack:

- Backend: Node.js + TypeScript + Express + Socket.io
- Database: PostgreSQL + Prisma ORM + Redis (Caching) + Bull
- Encryption: NodeJS crypto
- Validation: Zod
- Mobile: Kotlin (Android only for MVP)
- Dashboard: Next.js 15 + TypeScript + Tailwind CSS
- Monorepo: Turborepo + pnpm
- Containerization: Docker

# Functional Flow
```java
┌─────────────┐
│   Company   │ Uploads file
└──────┬──────┘
       ↓
┌─────────────────────────────────┐
│     Backend (Express)           │
│  - Chunks file (5MB pieces)     │
│  - Encrypts each chunk          │
│  - Stores metadata in DB        │
└──────┬──────────────────────────┘
       ↓
┌─────────────────────────────────┐
│  Assignment Service             │
│  - Picks 3 best devices         │
│  - Creates ChunkLocation        │
└──────┬──────────────────────────┘
       ↓
┌─────────────────────────────────┐
│  Distribution Service           │
│  - Sends via WebSocket          │
│  - Waits for confirmation       │
└──────┬──────────────────────────┘
       ↓
┌─────────────────────────────────┐
│    Devices (3x)                 │
│  - Receive chunks               │
│  - Store locally                │
│  - Confirm receipt              │
└─────────────────────────────────┘

[Later: Company wants file back]

       ↓
┌─────────────────────────────────┐
│  Retrieval Service              │
│  - Looks up ChunkLocations      │
│  - Requests from devices        │
│  - Reassembles file             │
│  - Verifies checksum            │
└──────┬──────────────────────────┘
       ↓
┌─────────────┐
│   Company   │ Gets original file back!
└─────────────┘
```
# Repo Structure 
```java
vyomanaut/
│
├── apps/
│   ├── backend/                          # Main orchestration server
│   │   ├── src/
│   │   │   ├── server.ts                 # Entry point
│   │   │   │
│   │   │   ├── config/                   # Configuration
│   │   │   │   ├── database.ts           # Prisma client setup
│   │   │   │   ├── redis.ts              # Redis client
│   │   │   │   └── env.ts                # Environment variables
│   │   │   │
│   │   │   ├── modules/                  # Feature modules (organized by functionality)
│   │   │   │   │
│   │   │   │   ├── devices/              # Device Lifecycle Management
│   │   │   │   │   ├── device.controller.ts
│   │   │   │   │   ├── device.service.ts
│   │   │   │   │   ├── device.model.ts
│   │   │   │   │   └── device.types.ts
│   │   │   │   │
│   │   │   │   ├── files/                # File Processing Pipeline
│   │   │   │   │   ├── file.controller.ts
│   │   │   │   │   ├── file.service.ts
│   │   │   │   │   ├── chunking.service.ts
│   │   │   │   │   └── encryption.service.ts
│   │   │   │   │
│   │   │   │   ├── chunks/               # Chunk Management
│   │   │   │   │   ├── chunk.controller.ts
│   │   │   │   │   ├── chunk.service.ts
│   │   │   │   │   ├── assignment.service.ts   # Intelligent assignment
│   │   │   │   │   └── retrieval.service.ts    # Retrieval orchestration
│   │   │   │   │
│   │   │   │   ├── replication/          # Auto Replication & Healing
│   │   │   │   │   ├── replication.service.ts
│   │   │   │   │   ├── health.service.ts
│   │   │   │   │   └── replication.worker.ts   # Bull queue worker
│   │   │   │   │
│   │   │   │   ├── payments/             # Payment Calculation
│   │   │   │   │   ├── payment.service.ts
│   │   │   │   │   └── earnings.calculator.ts
│   │   │   │   │
│   │   │   │   ├── analytics/            # Analytics & Monitoring
│   │   │   │   │   ├── analytics.service.ts
│   │   │   │   │   └── metrics.service.ts
│   │   │   │   │
│   │   │   │   └── auth/                 # NEW: JWT, sessions
│   │   │   │       ├── auth.controller.ts
│   │   │   │       ├── auth.service.ts
│   │   │   │       └── auth.types.ts
│   │   │   │
│   │   │   ├── websocket/                # WebSocket Event Hub
│   │   │   │   ├── socket.handler.ts     # Main Socket.io logic
│   │   │   │   ├── device.events.ts      # Device-specific events
│   │   │   │   └── chunk.events.ts       # Chunk-specific events
│   │   │   │
│   │   │   ├── api/                      # REST API (Company Gateway)
│   │   │   │   ├── routes/
│   │   │   │   │   ├── files.routes.ts
│   │   │   │   │   ├── devices.routes.ts
│   │   │   │   │   └── analytics.routes.ts
│   │   │   │   └── middleware/
│   │   │   │       ├── auth.ts
│   │   │   │       ├── validate.ts        # NEW: Zod
│   │   │   │       ├── rateLimit.ts
│   │   │   │       ├── errorHandler.ts    # NEW
│   │   │   │       └── logger.ts          # NEW
│   │   │   │
│   │   │   ├── workers/                   # NEW
│   │   │   │   ├── healing.worker.ts
│   │   │   │   ├── metrics.worker.ts
│   │   │   │   └── cleanup.worker.ts
│   │   │   │
│   │   │   ├── utils/                    # Shared utilities
│   │   │   │   ├── crypto.ts
│   │   │   │   ├── checksum.ts
│   │   │   │   ├── logger.ts              # Winston setup
│   │   │   │   └── validators.ts
│   │   │   │
│   │   │   ├── storage/                   # NEW: Temp chunk storage
│   │   │   │   └── temp/
│   │   │   │
│   │   │   └── types/                    # TypeScript types
│   │   │       ├── device.types.ts
│   │   │       ├── file.types.ts
│   │   │       ├── chunk.types.ts
│   │   │       └── index.ts
│   │   │
│   │   ├── prisma/                       # Database
│   │   │   ├── schema.prisma             # Database schema
│   │   │   └── migrations/
│   │   │
│   │   ├── tests/                        # Tests
│   │   │   ├── unit/
│   │   │   ├── integration/
│   │   │   └── e2e/
│   │   │
│   │   ├── logs/                         # NEW: Log files
│   │   ├── docker/                       # NEW: Deployment
│   │   │   ├── Dockerfile
│   │   │   └── docker-compose.prod.yml
│   │   │
│   │   ├── .env.example
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── dashboard/                        # Next.js company portal
│   │   ├── app/
│   │   │   ├── (auth)/            ← Login, signup
│   │   │   ├── (dashboard)/       ← Main app
│   │   │   │   ├── files/
│   │   │   │   ├── devices/
│   │   │   │   ├── analytics/
│   │   │   │   └── settings/
│   │   │   └── api/               ← Next.js API routes
│   │   ├── components/
│   │   │   ├── ui/                ← shadcn components
│   │   │   ├── files/
│   │   │   ├── devices/
│   │   │   └── charts/
│   │   ├── lib/
│   │   │   ├── api.ts             ← Backend API client
│   │   │   └── auth.ts
│   │   └── types/
│   │
│   └── mobile/                    ← Rename from android
│       ├── android/                          # Kotlin mobile app
│       │   └── app/
│       └── ios/                   ← Future
│
├── packages/
│   ├── shared/                           # Shared types across apps
│   │   ├── types/
│   │   │   ├── Device.ts
│   │   │   ├── File.ts
│   │   │   ├── Chunk.ts
│   │   │   └── index.ts
│   │   ├── constants/             ← NEW: Shared constants
│   │   └── validators/            ← NEW: Shared Zod schemas
│   │   └── package.json
│   │
│   └── api-client/                ← NEW: Shared API client
│
├── docs/
│   ├── api/                       ← NEW: API docs
│   │   ├── swagger.json
│   │   └── postman.json
│   ├── architecture/              ← NEW: Detailed docs
│   │   ├── data-flow.md
│   │   ├── security.md
│   │   └── scaling.md
│   ├── guides/
│   │   ├── deployment.md          ← NEW
│   │   └── development.md
│   ├── architecture.md
│   ├── api-reference.md
│   └── demo-script.md
│
├── scripts/
│   ├── setup.sh
│   ├── deploy.sh                  ← NEW
│   ├── seed/                      ← NEW: Organized seeds
│   │   ├── devices.ts
│   │   ├── files.ts
│   │   └── companies.ts
│   └── migrations/                ← NEW: Data migrations
│   └── seed-database.ts
│
├── docker-compose.yml                    # Local dev: PostgreSQL + Redis
├── turbo.json
├── .github/
│   └── workflows/                 ← NEW: CI/CD
│       ├── test.yml
│       ├── deploy-staging.yml
│       └── deploy-prod.yml
└── package.json
```


 # The backend 
 It is…. 

<aside>
💡

A coordination server that acts as the "air traffic controller" for millions of data chunks flying between company servers and personal devices.

</aside>

An Analogy

```java
Think of it like Uber's backend:

Uber doesn't drive the cars (devices store the data)
Uber doesn't own the roads (internet is the network)
Uber connects riders to drivers and tracks everything
That's exactly what your backend does for data chunks and devices
```

    # 🎯 10 Core Functionalities of Backend 
    
    1. Manage Device Lifecycle 
    2. Manage WebSocket Event 
    3. Process Files to chunks and encrypt it 
    4. Store Chunks Locations
    5. Intelligently Assign Chunks
    6. Retrieve the chunks -> turn into files
    7. Automatic Replication & Healing (in case of loss)
    8. Server Health Monitoring
    9.  Calculate Payments
    10. Company API Gateway

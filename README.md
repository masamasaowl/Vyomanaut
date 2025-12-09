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


# Repo Structure 
```java
vyomanaut/
│
├── apps/
│   ├── backend/                          # Main orchestration server
│   │   ├── src/
│   │   │   ├── server.ts                 # Entry point
│   │   │   │
│   │   │   ├── config/                   # Configure useful resources
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
│   │   │   │   └── analytics/            # Analytics & Monitoring
│   │   │   │       ├── analytics.service.ts
│   │   │   │       └── metrics.service.ts
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
│   │   │   │       ├── validate.ts
│   │   │   │       └── rateLimit.ts
│   │   │   │
│   │   │   ├── utils/                    # Shared utilities
│   │   │   │   ├── crypto.ts
│   │   │   │   ├── checksum.ts
│   │   │   │   ├── logger.ts
│   │   │   │   └── validators.ts
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
│   │   ├── .env.example
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── dashboard/                        # Next.js company portal
│   │   ├── app/
│   │   ├── components/
│   │   └── lib/
│   │
│   └── android/                          # Kotlin mobile app
│       └── app/
│
├── packages/
│   └── shared/                           # Shared types across apps
│       ├── types/
│       │   ├── Device.ts
│       │   ├── File.ts
│       │   ├── Chunk.ts
│       │   └── index.ts
│       └── package.json
│
├── docs/
│   ├── architecture.md
│   ├── api-reference.md
│   └── demo-script.md
│
├── scripts/
│   ├── setup.sh
│   └── seed-database.ts
│
├── docker-compose.yml                    # Local dev: PostgreSQL + Redis
├── turbo.json
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

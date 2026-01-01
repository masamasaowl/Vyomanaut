# Vyomanaut🚀

> The Problem: Data centres consume 1-3% of global electricity and are expanding rapidly & advancements in AI are all set to increase these figures. Meanwhile, billions of devices sit idle with unused storage.
> 

So..

<aside>
💡

What if we could turn every phone and laptop into part of the cloud? Vyomanaut lets users rent their device storage to companies and earn money—democratizing cloud infrastructure while reducing environmental impact.

</aside>

Two wins:
1. For You: Earn money from space you're not using anyway
2. For Companies: Pay way less than AWS/Google Cloud
3. Bonus: Less strain on data centres and the environment


# How It Works


The Journey of a File
Handed with trust to Vyomanaut 
```
📤 UPLOAD JOURNEY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Company uploads file.pdf
   Say it has a size = 3GB
   ↓
2. Backend: "Let me slice this pizza! 1GB at a time"
   ├─ Chunk 0 (1GB) → Encrypt → Store temporarily ( deleted regularly )
   ├─ Chunk 1 (1GB) → Encrypt → Store temporarily
   └─ Chunk 2 (1GB) → Encrypt → Store temporarily
   ↓
3. Backend: "Who's available to store these?"
   ├─ Finds Device A (online, reliable, 2GB free)
   ├─ Finds Device B (online, reliable, 15GB free)
   └─ Finds Device C (offline, reliable, 8GB free)
   └─ Finds Device D (online, less reliable, 6GB free)
   ↓
4. Backend sends via WebSocket (based on reliability score):
   ├─ Chunk 0 → Device A, B, D
   ├─ Chunk 1 → Device A, B, D
   └─ Chunk 2 → Device B, D, E
   ↓
5. Devices confirm: "Got it! Stored safely!"
   ↓
6. Backend marks file as ACTIVE ✅
   ↓
7. Backend deletes temporary copies
   (Only devices have the chunks now!)


📥 DOWNLOAD JOURNEY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Company: "I want file.pdf back"
   ↓
2. Backend: "Let me find all the slices!"
   ├─ Checks database: Where is Chunk 0? (Device A, B, D)
   ├─ Checks database: Where is Chunk 1? (Device A, B, D)
   └─ Checks database: Where is Chunk 2? (Device B, D, E)
   ↓
3. Backend requests via WebSocket:
   ├─ "Device B, send Chunk 0, 1, 2"
   └─ (Only needs 1 device if it has all chunks)
   ↓
4. Device B sends all chunks
   ↓
5. Backend:
   ├─ Receives encrypted chunks
   ├─ Decrypts each one
   ├─ Puts them in order (0, 1, 2)
   ├─ Verifies checksum (file not corrupted?)
   └─ Reassembles original file
   ↓
6. Returns file.pdf to company ✅
```

# Tech Stack:

- Backend: Node.js + TypeScript + Express + Socket.io
- Database: PostgreSQL + Prisma ORM + Redis + Bull
- Security: AES-256-GCM + HKDF + JWT + Bcrypt + Zod
- Dashboard: Next.js 15 + TypeScript + Tailwind CSS
- Monorepo: Turborepo + pnpm
- Containerization: Docker


# Repo Structure 
```java
vyomanaut/
│
├── apps/
│   ├── backend/              
│   │   ├── src/
│   │   │   ├── server.ts            # Main entry point
│   │   │   ├── config/              # Database, Redis, environment
│   │   │   ├── modules/             # Feature folders
│   │   │   │   ├── devices/         # Device lifecycle
│   │   │   │   ├── files/           # File processing
│   │   │   │   ├── chunks/          # Chunk management
│   │   │   │   ├── auth/            # Login/signup
│   │   │   │   └── payments/        # Earnings tracking
│   │   │   ├── websocket/           # Real-time events
│   │   │   ├── api/                 # REST endpoints
│   │   │   ├── workers/             # Background jobs
│   │   │   └── utils/               # Helper functions
│   │   ├── prisma/                  # Database schema
│   │   └── tests/                   # Unit + Integration tests
│   │
│   ├── Vyomanaut-Enterprise/            # Company web portal (Next.js)
│   └── Vyomanaut-Explorer/               # User mobile app (Kotlin)
│
├── packages/
│   └── shared/               # Code used by all apps
│
└── docs/                     # Documentation
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
That's exactly what our backend does for data chunks and devices
```

    # 🎯 10 Core Functionalities of Backend 
    
    1. File Upload & Download - Companies can store/retrieve files
    2. Real-Time Device Communication - WebSockets keep devices connected
    3. Industry-Grade Encryption - AES-256-GCM ( used by VPNs and TLS in https)
    4. Store Chunks Locations - Like a register to track which device has which chunk
    5. Intelligently Assign Chunks - Based on reliability 
    6. Self-Healing - If a device goes offline, automatically creates new copies
    7. Auto-Replication - Always keeps 3 copies of every chunk
    8. Earnings Calculator - Tracks how much you earn per GB per hour
    9. Authentication System - JWT tokens for users and companies
    10. API Access - Companies can integrate via REST APIs


# 📄Questions

- 
    
    **Q: "How is this different from Storj?"**
    
    **A:** "Storj targets crypto users and requires technical setup. Vyomanaut is for mainstream users—one-tap install, earn in regular currency. We're also India-first, targeting the 700M smartphone market here."


    **Q: "How is this different from Dropbox?"**
    
    **A:** "Dropbox stores your data in their data centers. We distribute it across thousands of user devices - cheaper and greener!"

    
    **Q: "What if a device loses my chunk?"**
    
    **A:** "We keep 3 copies on different devices. If one goes offline, we automatically create a new copy and clone it to another device, this ensures the file stays just a click away from you"


    **Q: "Can device owners read my files?"**
    
    **A:** "Everything is encrypted before it leaves our server. They just see random gibberish: a8f4c2e9d7b3... If they tamper with the data, the GCM module detects it and the device gets suspended"


    **Q: "What if someone hacks a device?"**
    
    **A:** "Data is AES-256 encrypted before leaving our servers. Devices only store encrypted chunks. Without the key, it's useless. Even we can't decrypt it—only the company can."
    

    **Q: "Why would companies trust this?"**
    
    **A:** "We're targeting low-priority data where speed doesn't matter—backups, archives, cold storage. For critical data, they'll still use AWS. But for archival, they can easily prefer us"
    
    
    **Q: "What's your business model?"**
    
    **A:** "This remains an less researched topic for us. But just for numbers we can say: Companies pay $3/TB, we pay users $2.75/TB, and keep $0.25/TB. At 10,000TB stored, that's $75K/month revenue."


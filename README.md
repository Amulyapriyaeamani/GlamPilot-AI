# GlamPilot AI — Beauty Salon Marketplace & Growth Copilot

An AI-powered, full-stack beauty salon marketplace and business intelligence suite specifically tailored for the metropolitan region of Hyderabad. Built for the **SuperXgen AI Startup Buildathon 2026 – Beauty Salon Marketplace Challenge**.

**Team Name:** amulyapriyaeamani441  
**Team Members:**  
*   Amulya Priya Eamani  
*   Sindhu Boddu  

---

## Problem
The beauty and grooming industry in Hyderabad is thriving yet deeply fragmented. Customers and salon owners face distinct, persistent challenges:

### For Customers:
*   **Aesthetic Mismatch & Budget Anxiety:** Customers often struggle to find salons that deliver specific styling goals (e.g., Telugu bridal makeovers, premium airbrushing, corporate grooming) within their precise budget limits. Standard listings only show flat menu cards without calculating optimal service combinations.
*   **Information Overload:** Sifting through dozens of unorganized reviews across third-party websites makes it difficult to gauge a salon's true strengths and potential bottlenecks.
*   **Low Engagement & Fragmented Loyalty:** Traditional loyalty cards are easily lost, leading to poor customer retention and disconnected post-booking relationships.

### For Salon Partners:
*   **Unoptimized Idle Slots:** Mid-week afternoon slots suffer from low occupancy rates, while weekend demand is difficult to manage effectively.
*   **Lack of Actionable Analytics:** Small-to-medium salon operators lack access to data science tools to understand why customers churn, how to target high-value corporate clients, or how to launch high-conversion marketing campaigns.
*   **Generic Outreach:** Generalized discounts erode margins rather than boosting long-term customer lifetime value (LTV).

---

## Solution
**GlamPilot AI** bridges this gap as a dual-sided, hyper-localized marketplace platform. It uses Google's state-of-the-art Gemini LLM to curate the customer journey and supercharge partner salon operations.

1.  **AI Budget & Bundle Optimizer:** A proprietary recommendation engine that matches the user's budget and specific aesthetic goals with custom service bundles curated directly from real-time salon menus.
2.  **AI Salon Review Summarizer:** Generates executive-level overviews of client reviews, extracting explicit strengths, weaknesses, overall sentiment, and beauty-insider tips.
3.  **Salon Growth Copilot:** A partner dashboard equipped with real-time occupancy monitoring, financial KPIs, and deep business intelligence tailored to Hyderabad's regional trends.
4.  **AI Retention Advisor & Campaign Builder:** Uses client booking history and churn-risk indicators to design personalized recovery offers and automated, ready-to-dispatch marketing campaigns.

---

## Features

### 1. Client-Facing Marketplace
*   **Hyper-Localized Search:** Filter elite salons across key areas of Hyderabad: Jubilee Hills, Banjara Hills, Gachibowli, and Hitech City.
*   **Virtual Try-On Mirror Simulator:** An interactive 3D virtual try-on module that lets users preview hairstyle contours, luxury hair coloring highlights, and blush shades before booking.
*   **Glow Points Loyalty Engine:** An integrated rewards hub displaying earned tier levels, accumulated loyalty points, and active voucher claims to drive repeat bookings.
*   **Pristine Booking Interface:** Seamless slot selection, stylist preferences, and real-time confirmation.

### 2. Partner-Facing growth Dashboard
*   **Performance Metrics HUD:** Visualizes month-over-month revenue, average slot occupancy, and repeat client retention rates.
*   **AI Business Copilot Insights:** Context-aware alerts highlighting wedding season peaks, corporate tech-worker lunch rushes, and premium branding opportunities.
*   **AI Retention Advisor:** Evaluates client churn risks, outputs precise loyalty probabilities, and suggests custom-tailored outreach strategies.
*   **AI Marketing Campaign Generator:** Instantly drafts localized digital copy and action plans tailored to specific target audiences (e.g., Gachibowli IT professionals, wedding parties).

---

## User Flow

### Customer Journey:
1.  **Aesthetic Consult:** Customer enters their target budget, localized area, and styling objective (e.g., "Airbrush bridal look" or "De-stress corporate grooming").
2.  **Optimized Recommendations:** GlamPilot's AI budget engine analyzes menu prices and recommends specific salon bundles that deliver the highest value under budget.
3.  **Deep Dive & Simulation:** Customer inspects the selected salon's strengths, reads the AI-generated review summaries, and experiments with the virtual mirror try-on.
4.  **Instant Booking:** The client schedules an appointment, selects their preferred time, and earns Glow Points upon scheduling.

### Salon Partner Journey:
1.  **Dashboard Login:** Accesses the live Growth Copilot showing current operational metrics.
2.  **Insight Actioning:** Reviews automated notifications (e.g., "Weekday afternoon bookings are low") and selects the *Generate Marketing Campaign* option.
3.  **Client Care Outreach:** Identifies high-risk churn customers via the Retention Advisor and clicks *Proactive Outreach* to automatically prepare WhatsApp recovery slots.

---

## Tech Stack
*   **Frontend:** React 19, TypeScript, Vite
*   **Styling:** Tailwind CSS (Fluid design, glassmorphism panel styles, and fine-grain micro-interactions)
*   **Animation:** Motion (from `motion/react`) for graceful route transitions and component feedback loops
*   **Backend Server:** Express.js (Node CJS bundling via Esbuild for high-speed Cloud Run performance)
*   **AI Intelligence:** Google Gen AI SDK (`@google/genai`) powered by `gemini-3.5-flash` for high-throughput, structured JSON outputs
*   **Icons:** Lucide-React
*   **Build Tooling:** Esbuild & TSX

---

## Architecture
The application is structured as a full-stack, single-container architecture optimized for high-performance and cloud-native hosting environments (such as Google Cloud Run):

```
┌──────────────────────────────────────────────────────────────┐
│                       Client Browser                         │
│  (React 19 SPA, Tailwind UI, Motion, Interactive Mirror SIM)  │
└───────────────┬──────────────────────────────▲───────────────┘
                │ GET /api/* (JSON)            │ SPA Static Assets
                │ POST /api/* (JSON)           │ & Route Handling
┌───────────────▼──────────────────────────────┴───────────────┐
│                       Express Backend                        │
│   (Vite Assets Middleware, Router, Local Session Managers)   │
└───────────────┬──────────────────────────────▲───────────────┘
                │ JSON Payload with            │ Structured JSON
                │ Schema Definitions           │ Outputs (MIME Type)
┌───────────────▼──────────────────────────────┴───────────────┐
│                       Google Gemini API                      │
│      (gemini-3.5-flash LLM Model / Real-Time Generation)     │
└──────────────────────────────────────────────────────────────┘
```

---

## AI Usage & Prompt Engineering
GlamPilot AI utilizes zero-shot semantic mapping and highly rigid output schemas. Rather than returning unstructured text, the backend binds Gemini's inference directly to strict TypeScript types using `responseMimeType: "application/json"` and strict `responseSchema` definitions.

### Key API Handlers:
1.  **`/api/summarize-reviews`:** Maps unstructured consumer feedback into strengths, weaknesses, overall sentiment percentage, and localized insider tips.
2.  **`/api/dashboard-insights`:** Prompts the model with salon performance metrics and area-specific business models (e.g., Jubilee Hills premium branding vs Gachibowli high-density fast services) to construct actionable steps.
3.  **`/api/optimize-budget`:** Solves a multi-variable knapsack problem via LLM semantic scoring, prioritizing services that match the user's primary "goal" string while mathematically maximizing the remaining budget.
4.  **`/api/retention-advisor`:** Evaluates customer history patterns (booking frequency, last visit date, average ticket spend) to output an exact churn probability and tailored offering.

---

## Screenshots
*(Add high-fidelity screenshots of the interface here after deploying or recording the workspace view)*
*   **Home Marketplace:** Elegant, light-themed luxury card deck showing verified ratings, area badges, and booking indicators.
*   **AI Budget Planner:** Step-by-step diagnostic forms showing exact budget slider boundaries and custom objectives.
*   **Growth Copilot:** Dynamic metrics HUD with color-coded trend tickers, retention risk tables, and campaign copy drawers.
*   **Virtual Try-On Mirror:** Real-time 3D style canvas showcasing real-time interaction states.

---

## Future Roadmap
1.  **Google Maps Platform Integration:** Real-time distance matrix routing to guide clients to salons based on current Hyderabad traffic.
2.  **True Virtual Try-On AR Lens:** Upgrading the interactive try-on simulator using media-pipe facial mesh nodes for exact real-time camera overlays.
3.  **WhatsApp Business API Sync:** Enable salon partners to dispatch the generated AI marketing hooks and personalized retention vouchers directly to clients' phones in one click.
4.  **Multi-Tenant Calendar Calendaring:** Syncing directly with Google Calendar or Apple iCal for automated notifications.

---

## Team & SuperXgen Buildathon Metadata
*   **Challenge:** SuperXgen AI Startup Buildathon 2026 – Beauty Salon Marketplace Challenge
*   **Team Name:** amulyapriyaeamani441
*   **Project URL:** https://glampilot-ai-272580629844.asia-southeast1.run.app
*   **Members:**
    *   **Amulya Priya Eamani** 
    *   **Sindhu Boddu** 

---

## Acknowledgements

Built as part of the **SuperXgen AI Startup Buildathon 2026**.

Special thanks to the AI tools that accelerated development:
*   **ChatGPT**
*   **Gemini / Google AI Studio Build**
*   **Vite & Tailwind CSS Ecosystem**


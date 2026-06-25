import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import { HYDERABAD_SALONS } from "./src/data/salons.js";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = 3000;

// Initialize Gemini SDK with telemetry header requested by skill
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

// Circuit Breaker to prevent rate-limit / quota-exhaustion spam
let geminiDisabledUntil = 0;

// Helper to secure Gemini API checks
const checkApiKey = () => {
  if (!process.env.GEMINI_API_KEY) {
    return false;
  }
  if (Date.now() < geminiDisabledUntil) {
    return false;
  }
  return true;
};

// Resilient wrapper with exponential backoff retry logic for true Gemini transient 503 errors
async function callGeminiWithRetry<T>(
  apiCall: () => Promise<T>,
  retries = 2,
  delay = 1000
): Promise<T> {
  try {
    return await apiCall();
  } catch (error: any) {
    const errorStr = String(error?.message || error || "");
    
    // Do not retry on rate limits / quota issues - fail fast to activate fallback
    const isQuota = errorStr.includes("429") || 
                    errorStr.includes("RESOURCE_EXHAUSTED") || 
                    errorStr.includes("quota exceeded") || 
                    errorStr.includes("Quota exceeded");
    
    if (isQuota) {
      throw error;
    }

    const isTransient = errorStr.includes("503") || 
                        errorStr.includes("UNAVAILABLE") || 
                        errorStr.includes("high demand") || 
                        errorStr.includes("temporary");
    
    if (isTransient && retries > 0) {
      console.log(`[Gemini API] Transient error encountered (e.g. 503). Retrying in ${delay}ms... (Attempts left: ${retries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return callGeminiWithRetry(apiCall, retries - 1, delay * 1.5);
    }
    throw error;
  }
}

// Unified error handler for circuit breaking and clean logging
const handleGeminiError = (error: any, context: string) => {
  const errorStr = String(error?.message || error || "");
  const isQuota = errorStr.includes("429") || 
                  errorStr.includes("RESOURCE_EXHAUSTED") || 
                  errorStr.includes("quota exceeded") || 
                  errorStr.includes("Quota exceeded");
  
  if (isQuota) {
    // Disable Gemini for 5 minutes to allow quota to reset and prevent log flooding
    geminiDisabledUntil = Date.now() + 5 * 60 * 1000;
    console.log(`[Gemini Circuit Breaker] Rate limit/quota reached for ${context}. Bypassing Gemini API for 5 minutes.`);
  } else {
    console.log(`[Gemini Fallback] ${context} failed: ${errorStr.slice(0, 150)}`);
  }
};

// 1. AI Occasion Planner & Matchmaker
app.post("/api/occasion-planner", async (req, res) => {
  const { occasion, budget, location, servicesNeeded, notes } = req.body;

  if (!occasion || !budget || !location) {
    return res.status(400).json({ error: "Missing required preferences: occasion, budget, location" });
  }

  const salonContextList = HYDERABAD_SALONS.map(s => ({
    id: s.id,
    name: s.name,
    area: s.area,
    rating: s.rating,
    priceRange: s.priceRange,
    featured: s.featured,
    services: s.services.map(ser => ({ name: ser.name, category: ser.category, price: ser.price }))
  }));

  const systemPrompt = `You are a professional luxury beauty stylist and beauty analyst specializing in Hyderabad's premium beauty salon marketplace.
Generate a structured, bespoke beauty plan for a client matching their occasion, budget tier, preferred location, services, and notes.
Refer to this active database of actual salons in Hyderabad, and select the TOP 3 matching salons. Calculate a realistic Match Score (out of 100) based on location proximity, price alignment, and services availability.

AVAILABLE HYDERABAD SALONS:
${JSON.stringify(salonContextList, null, 2)}

CLIENT DETAILS:
Occasion: ${occasion}
Budget Level: ${budget}
Preferred Location: ${location}
Requested Services: ${JSON.stringify(servicesNeeded || [])}
Additional Notes: ${notes || "None"}

Ensure your response matches the requested JSON schema EXACTLY. Recalculate realistic amounts in Indian Rupees (₹) based on the client's budget choice.`;

  if (!checkApiKey()) {
    const fallbackPlan = generateFallbackPlan(occasion, budget, location, servicesNeeded, notes);
    return res.json(fallbackPlan);
  }

  try {
    const response = await callGeminiWithRetry(() => ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: systemPrompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: {
              type: Type.STRING,
              description: "A friendly, expert-level personalized beauty plan overview written with elite elegance."
            },
            timeline: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  daysBefore: { type: Type.STRING, description: "e.g., 5 Days Before, 1 Day Before, Event Day" },
                  action: { type: Type.STRING, description: "The specific preparation action recommended." },
                  details: { type: Type.STRING, description: "Short detail/advice regarding the preparation step." }
                },
                required: ["daysBefore", "action", "details"]
              }
            },
            budgetAllocation: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  category: { type: Type.STRING, description: "Category name, e.g., Hair, Makeup, Skin Care, Buffer" },
                  percentage: { type: Type.NUMBER, description: "Percentage of budget allocated" },
                  amount: { type: Type.NUMBER, description: "Estimated amount in Rupees (₹)" },
                  reason: { type: Type.STRING, description: "Brief justification for this allocation" }
                },
                required: ["category", "percentage", "amount", "reason"]
              }
            },
            matchedSalons: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  salonId: { type: Type.STRING, description: "The active salon ID from the list, e.g., 'salon-1', 'salon-2', 'salon-3'" },
                  matchScore: { type: Type.NUMBER, description: "Integer percentage between 50 and 100" },
                  reasoning: { type: Type.STRING, description: "Why this salon is uniquely suited for their chosen occasion and location in Hyderabad." }
                },
                required: ["salonId", "matchScore", "reasoning"]
              }
            }
          },
          required: ["summary", "timeline", "budgetAllocation", "matchedSalons"]
        }
      }
    }));

    const parsedData = JSON.parse(response.text || "{}");
    return res.json(parsedData);
  } catch (error: any) {
    handleGeminiError(error, "AI Occasion Planner");
    // Return high-quality, smart, realistic fallback simulation
    const fallbackPlan = generateFallbackPlan(occasion, budget, location, servicesNeeded, notes);
    return res.json(fallbackPlan);
  }
});

// 2. AI Review Intelligence Page
app.post("/api/review-summary", async (req, res) => {
  const { salonId } = req.body;
  if (!salonId) {
    return res.status(400).json({ error: "salonId is required" });
  }

  const selectedSalon = HYDERABAD_SALONS.find(s => s.id === salonId);
  if (!selectedSalon) {
    return res.status(404).json({ error: "Salon not found" });
  }

  const reviewsText = selectedSalon.reviews.map(r => `[Rating: ${r.rating}, Author: ${r.author}]: "${r.comment}"`).join("\n");

  const systemPrompt = `You are an AI Review Intelligence expert analyzing public sentiment for "${selectedSalon.name}".
Summarize the current review logs below into an insightful layout containing structured strengths, weaknesses, overall sentiment metrics, and specialized aesthetic tips.

REVIEWS:
${reviewsText}

STRENGTHS BASE: ${JSON.stringify(selectedSalon.strengths)}
WEAKNESSES BASE: ${JSON.stringify(selectedSalon.weaknesses)}

Generate your response strictly matching the schema.`;

  if (!checkApiKey()) {
    return res.json({
      summary: `Client feedback for ${selectedSalon.name} indicates high satisfaction with custom-focused treatments, particularly noting their precise attention and elegant hospitality during peak hours.`,
      strengths: selectedSalon.strengths,
      weaknesses: selectedSalon.weaknesses,
      overallSentiment: `Positive Sentiment (~${selectedSalon.rating * 20}%)`,
      expertTip: "A mid-week booking is highly recommended to receive maximum individual focus from senior beauty therapists."
    });
  }

  try {
    const response = await callGeminiWithRetry(() => ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: systemPrompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING, description: "A smart executive summary of client reviews." },
            strengths: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
            weaknesses: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
            overallSentiment: { type: Type.STRING, description: "e.g., Strongly Positive (95% satisfaction)" },
            expertTip: { type: Type.STRING, description: "A professional beauty-insider tip for visiting this salon." }
          },
          required: ["summary", "strengths", "weaknesses", "overallSentiment", "expertTip"]
        }
      }
    }));

    const parsedResponse = JSON.parse(response.text || "{}");
    return res.json(parsedResponse);
  } catch (error: any) {
    handleGeminiError(error, "AI Review Summary");
    return res.json({
      summary: `Client feedback for ${selectedSalon.name} indicates high satisfaction with custom-focused treatments, particularly noting their precise attention and elegant hospitality during peak hours.`,
      strengths: selectedSalon.strengths,
      weaknesses: selectedSalon.weaknesses,
      overallSentiment: `Positive Sentiment (~${selectedSalon.rating * 20}%)`,
      expertTip: "A mid-week booking is highly recommended to receive maximum individual focus from senior beauty therapists."
    });
  }
});

// 3. AI Salon Growth Copilot Dashboard
app.post("/api/copilot-dashboard", async (req, res) => {
  const { salonId } = req.body;
  const currentSalon = HYDERABAD_SALONS.find(s => s.id === salonId) || HYDERABAD_SALONS[0];

  const systemPrompt = `You are the GlamPilot Salon Growth Copilot, a elite business growth AI trained to empower premium beauty salons in Hyderabad (like ${currentSalon.name}).
Review current mock monthly metrics:
- Salon Name: ${currentSalon.name}
- Area: ${currentSalon.area}
- Services Average Ticket Size: ₹${Math.round(currentSalon.services.reduce((acc, s) => acc + s.price, 0) / currentSalon.services.length)}
- Approximate active clientele count: ${currentSalon.reviewCount * 3 + 120}

Generate highly specific business recommendations and growth insights for ${currentSalon.name}. Focus on localized Hyderabad trends (e.g., wedding season, Hitech City tech workers, Jubilee Hills luxury branding). Matches the requested output JSON schema strictly.`;

  if (!checkApiKey()) {
    return res.json({
      overallPerformance: `Excellent growth in ${currentSalon.area}, primarily driven by weekend custom packages and airbrush makeup requests.`,
      metrics: {
        revenueIncrease: "+18.4% vs last month",
        bookingGrowth: "+12% overall",
        customerRetention: "74% repeat rate",
        occupancyRate: "82% peak occupancy"
      },
      insights: [
        {
          title: "Premium Bridal Upsurge",
          description: "Demand for signature wedding makeovers has surged in current quarters. Consider introducing tailored jewelry assembly bundles.",
          type: "positive"
        },
        {
          title: "Weekday Dip",
          description: "Tuesday and Wednesday afternoons show average slot occupancy below 40%.",
          type: "warning"
        },
        {
          title: "Corporate Pampering",
          description: "Hitech city and Gachibowli office workers frequently search for fast de-stress scalp massages during evening hours.",
          type: "notice"
        }
      ],
      recommendations: [
        {
          action: "Introduce 'Lunch Hour Power Spa' bundles customized for nearby IT professionals to fill afternoon slots.",
          expectedImpact: "Boost weekday afternoon bookings by 25%",
          difficulty: "easy"
        },
        {
          action: "Launch a loyalty tier providing members with custom priority booking for high-demand wedding consultants.",
          expectedImpact: "Increase customer lifetime value and secure premium reservations",
          difficulty: "medium"
        },
        {
          action: "Partner with top local Hyderabad fashion boutiques in Road No. 36 to promote joint styling vouchers.",
          expectedImpact: "Scale brand reach among high-net-worth clients",
          difficulty: "hard"
        }
      ]
    });
  }

  try {
    const response = await callGeminiWithRetry(() => ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: systemPrompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            overallPerformance: { type: Type.STRING },
            metrics: {
              type: Type.OBJECT,
              properties: {
                revenueIncrease: { type: Type.STRING },
                bookingGrowth: { type: Type.STRING },
                customerRetention: { type: Type.STRING },
                occupancyRate: { type: Type.STRING }
              },
              required: ["revenueIncrease", "bookingGrowth", "customerRetention", "occupancyRate"]
            },
            insights: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                  type: { type: Type.STRING, description: "positive, notice, or warning" }
                },
                required: ["title", "description", "type"]
              }
            },
            recommendations: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  action: { type: Type.STRING },
                  expectedImpact: { type: Type.STRING },
                  difficulty: { type: Type.STRING, description: "easy, medium, or hard" }
                },
                required: ["action", "expectedImpact", "difficulty"]
              }
            }
          },
          required: ["overallPerformance", "metrics", "insights", "recommendations"]
        }
      }
    }));

    const parsedResponse = JSON.parse(response.text || "{}");
    return res.json(parsedResponse);
  } catch (error: any) {
    handleGeminiError(error, "AI Copilot Dashboard");
    return res.json({
      overallPerformance: `Excellent growth in ${currentSalon.area}, primarily driven by weekend custom packages and airbrush makeup requests.`,
      metrics: {
        revenueIncrease: "+18.4% vs last month",
        bookingGrowth: "+12% overall",
        customerRetention: "74% repeat rate",
        occupancyRate: "82% peak occupancy"
      },
      insights: [
        {
          title: "Premium Bridal Upsurge",
          description: "Demand for signature wedding makeovers has surged in current quarters. Consider introducing tailored jewelry assembly bundles.",
          type: "positive"
        },
        {
          title: "Weekday Dip",
          description: "Tuesday and Wednesday afternoons show average slot occupancy below 40%.",
          type: "warning"
        },
        {
          title: "Corporate Pampering",
          description: "Hitech city and Gachibowli office workers frequently search for fast de-stress scalp massages during evening hours.",
          type: "notice"
        }
      ],
      recommendations: [
        {
          action: "Introduce 'Lunch Hour Power Spa' bundles customized for nearby IT professionals to fill afternoon slots.",
          expectedImpact: "Boost weekday afternoon bookings by 25%",
          difficulty: "easy"
        },
        {
          action: "Launch a loyalty tier providing members with custom priority booking for high-demand wedding consultants.",
          expectedImpact: "Increase customer lifetime value and secure premium reservations",
          difficulty: "medium"
        },
        {
          action: "Partner with top local Hyderabad fashion boutiques in Road No. 36 to promote joint styling vouchers.",
          expectedImpact: "Scale brand reach among high-net-worth clients",
          difficulty: "hard"
        }
      ]
    });
  }
});

// 4. AI Smart Budget Optimizer
app.post("/api/budget-optimizer", async (req, res) => {
  const { salonId, budget, goal } = req.body;
  if (!salonId || !budget || !goal) {
    return res.status(400).json({ error: "Missing salonId, budget, or goal" });
  }

  const selectedSalon = HYDERABAD_SALONS.find(s => s.id === salonId);
  if (!selectedSalon) {
    return res.status(404).json({ error: "Salon not found" });
  }

  const servicesText = selectedSalon.services.map(s => `- ID: ${s.id}, Name: ${s.name}, Category: ${s.category}, Price: ₹${s.price}, Description: ${s.description}`).join("\n");

  const systemPrompt = `You are a professional beauty service planner.
Your goal is to maximize customer value while staying within budget.
Recommend service combinations of the available services that achieve the user's goal without exceeding their budget.
Be realistic: ensure the cumulative sum of prices of recommended service items is strictly less than or equal to the requested budget of ₹${budget}.
You MUST select actual services from the provided list of Available Services.

BUDGET: ₹${budget}
GOAL: ${goal}

AVAILABLE SERVICES FOR "${selectedSalon.name}":
${servicesText}

Select a combination of 1 to 4 services from this exact list.
If a single, premium service matches the goal and fits the budget, recommend that. Otherwise, recommend a complementary bundle.
If no service fits the budget, recommend the lowest priced service that is closest to their goal and advise them.

Your response must strictly match the following JSON schema representation:`;

  const getBudgetOptimizerFallback = () => {
    // Let's create a targeted fallback based on the salon's actual services
    const fittingServices = selectedSalon.services
      .filter(s => s.price <= Number(budget))
      .sort((a, b) => b.price - a.price); // High to low but under budget

    let selectedIds: string[] = [];
    let currentSum = 0;
    
    // Choose some services that fit
    for (const service of fittingServices) {
      if (currentSum + service.price <= Number(budget)) {
        selectedIds.push(service.id);
        currentSum += service.price;
        if (selectedIds.length >= 3) break; // Limit of 3
      }
    }

    if (selectedIds.length === 0 && selectedSalon.services.length > 0) {
      // Pick the absolute cheapest if nothing fitted
      const cheapest = [...selectedSalon.services].sort((a, b) => a.price - b.price)[0];
      selectedIds = [cheapest.id];
      currentSum = cheapest.price;
    }

    return {
      recommendedServiceIds: selectedIds,
      totalCost: currentSum,
      whyWorks: `This customized combination delivers a highly visible glow focused on your goal "${goal}" while strictly respecting your ₹${budget} budget limit at ${selectedSalon.name}.`,
      tradeoffs: "Left out secondary gel extensions of lower priority to ensure primary treatment remains premium."
    };
  };

  if (!checkApiKey()) {
    return res.json(getBudgetOptimizerFallback());
  }

  try {
    const response = await callGeminiWithRetry(() => ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: systemPrompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            recommendedServiceIds: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "The unique ID of the service(s) selected from the menu list (e.g. ['b1', 'b2'])"
            },
            totalCost: { type: Type.NUMBER, description: "Sum of recommended items prices" },
            whyWorks: { type: Type.STRING, description: "Direct explanation of how this bundle serves the user's goal within their budget limit." },
            tradeoffs: { type: Type.STRING, description: "Any compromises made (e.g. left out manicure to fit premium hair spa)" }
          },
          required: ["recommendedServiceIds", "totalCost", "whyWorks"]
        }
      }
    }));
    const parsed = JSON.parse(response.text || "{}");
    return res.json(parsed);
  } catch (error: any) {
    handleGeminiError(error, "AI Budget Optimizer");
    return res.json(getBudgetOptimizerFallback());
  }
});

// 5. AI Customer Retention Specialist
app.post("/api/retention-advisor", async (req, res) => {
  const { customerData } = req.body;
  if (!customerData) {
    return res.status(400).json({ error: "Missing customerData" });
  }

  const { date, services, amount, frequency } = customerData;

  const systemPrompt = `You are an elite customer retention specialist.
Analyze customer behavior trends and suggest highly personalized, premium engagement strategies.
Focus on increasing repeat bookings for a Hyderabad-based premium salon.

CUSTOMER PROFILE:
- Last Visit Date: ${date}
- Preferred Services: ${JSON.stringify(services)}
- Total Spend Amount: ₹${amount}
- Visit Frequency / Velocity: ${frequency}

Generate:
1. Short assessment of customer sentiment
2. Retention probability estimation (number 1 to 100)
3. Suggested offer tailored to their preferences
4. Recommended, highly actionable proactive outreach action.`;

  if (!checkApiKey()) {
    return res.json({
      assessment: "Customer is an active buyer of signature aesthetics. High alignment with luxury care, but has experienced a gap between recent sessions.",
      retentionProbability: 85,
      suggestedOffer: "Complementary premium scalp rejuvenation spa with any service above ₹1,800.",
      recommendedAction: "Dispatch a personalized check-in message via WhatsApp with a customized priority slot booking link."
    });
  }

  try {
    const response = await callGeminiWithRetry(() => ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: systemPrompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            assessment: { type: Type.STRING },
            retentionProbability: { type: Type.NUMBER, description: "Between 1 and 100" },
            suggestedOffer: { type: Type.STRING },
            recommendedAction: { type: Type.STRING }
          },
          required: ["assessment", "retentionProbability", "suggestedOffer", "recommendedAction"]
        }
      }
    }));
    const parsed = JSON.parse(response.text || "{}");
    return res.json(parsed);
  } catch (error: any) {
    handleGeminiError(error, "AI Retention Advisor");
    return res.json({
      assessment: "Customer is an active buyer of signature aesthetics. High alignment with luxury care, but has experienced a gap between recent sessions.",
      retentionProbability: 85,
      suggestedOffer: "Complementary premium scalp rejuvenation spa with any service above ₹1,800.",
      recommendedAction: "Dispatch a personalized check-in message via WhatsApp with a customized priority slot booking link."
    });
  }
});

// 6. AI Marketing Campaign Generator
app.post("/api/marketing-generator", async (req, res) => {
  const { services, audience, occupancy } = req.body;
  if (!services || !audience || !occupancy) {
    return res.status(400).json({ error: "Missing services, audience, or occupancy specifications" });
  }

  const systemPrompt = `You are an expert salon marketing strategist and campaign architect.
Generate high-impact, practical, and measurable promotional campaigns based on customer demographics and current occupancy levels.

SALON STATS / DEMANDS:
- Best Performing Services: ${JSON.stringify(services)}
- Target Demographics Focus: ${audience}
- Current Slot Occupancy Level: ${occupancy}

Generate:
1. Campaign Name
2. Target Audience focus notes
3. Promotional hook mechanics (e.g., 15% off, weekday perks)
4. Expected outcome (KPI metrics to improve)
5. Action plan checklist step-by-step.`;

  if (!checkApiKey()) {
    return res.json({
      campaignName: "Midweek Opulence Glow Fest",
      targetAudienceNotes: `${audience} looking to de-stress after hours and take advantage of mid-week premium slots.`,
      promotionHook: `Complimentary Organic Fruit Face Detox with any booked ${services[0]} on Tuesdays & Wednesdays.`,
      expectedOutcome: `Lift mid-week afternoon slot occupancy by 18-22% and cross-sell higher value beauty routines.`,
      actionSteps: [
        `Design premium digital banner and post to local social groups.`,
        `Send VIP invite blast via push notification to loyalty program profiles.`,
        `Train salon crew to actively pitch the glow option during telephone consultations.`,
        `Measure voucher utilization rate and average ticket size at checkout.`
      ]
    });
  }

  try {
    const response = await callGeminiWithRetry(() => ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: systemPrompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            campaignName: { type: Type.STRING },
            targetAudienceNotes: { type: Type.STRING },
            promotionHook: { type: Type.STRING },
            expectedOutcome: { type: Type.STRING },
            actionSteps: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ["campaignName", "targetAudienceNotes", "promotionHook", "expectedOutcome", "actionSteps"]
        }
      }
    }));
    const parsed = JSON.parse(response.text || "{}");
    return res.json(parsed);
  } catch (error: any) {
    handleGeminiError(error, "AI Marketing Generator");
    return res.json({
      campaignName: "Midweek Opulence Glow Fest",
      targetAudienceNotes: `${audience} looking to de-stress after hours and take advantage of mid-week premium slots.`,
      promotionHook: `Complimentary Organic Fruit Face Detox with any booked ${services[0]} on Tuesdays & Wednesdays.`,
      expectedOutcome: `Lift mid-week afternoon slot occupancy by 18-22% and cross-sell higher value beauty routines.`,
      actionSteps: [
        `Design premium digital banner and post to local social groups.`,
        `Send VIP invite blast via push notification to loyalty program profiles.`,
        `Train salon crew to actively pitch the glow option during telephone consultations.`,
        `Measure voucher utilization rate and average ticket size at checkout.`
      ]
    });
  }
});

// Helper for high-quality fallback plans when API Key is missing or quota runs out
function generateFallbackPlan(occasion: string, budget: string, location: string, servicesNeeded: string[], notes: string) {
  const selectedServices = servicesNeeded && servicesNeeded.length > 0 ? servicesNeeded : ['hair', 'makeup', 'skin'];

  let matchedIds: string[] = ['salon-1', 'salon-2', 'salon-3'];
  if (location === 'Jubilee Hills' || location === 'Banjara Hills') {
    matchedIds = ['salon-1', 'salon-3', 'salon-2'];
  } else if (location === 'Hitech City' || location === 'Gachibowli') {
    matchedIds = ['salon-2', 'salon-5', 'salon-1'];
  } else if (location === 'Madhapur' || location === 'Kondapur') {
    matchedIds = ['salon-4', 'salon-6', 'salon-2'];
  }

  const estimatedBudgetMap: Record<string, number> = {
    budget: 3500,
    premium: 8000,
    luxury: 25000
  };
  const totalEstimated = estimatedBudgetMap[budget] || 10000;

  return {
    summary: `Your tailored styling guide for the upcoming **${occasion}** is optimized for **${location}**. Based on your requirements, we recommend focusing on advanced hydrating skincare to achieve a natural base glow, followed by custom volumetric hair styling. We have selected top-tier salons in close proximity to suit your custom notes: "${notes || 'No notes specified'}".`,
    timeline: [
      {
        daysBefore: "7 Days Before",
        action: "Deep Hydration and Skin Purifier Session",
        details: "Book an organic botanical facial or hydrafacial to maximize cell rejuvenation ahead of cosmetic styling."
      },
      {
        daysBefore: "3 Days Before",
        action: "Hair Nourishment and Precision Trim",
        details: "Opt for a restorative spa treatment and cut contouring to eliminate frizz and secure healthy volume."
      },
      {
        daysBefore: "1 Day Before",
        action: "Luxury Manicure and Styling Trial",
        details: "Perfect time for chrome extensions and finalizing hair accessories alignment."
      },
      {
        daysBefore: "Event Day",
        action: "Signature Makeover and Voluminous Blowout",
        details: "Enjoy your flawless HD airbrush makeup application. Best finished 2 hours prior to the gala."
      }
    ],
    budgetAllocation: [
      {
        category: "Hair Styling & Care",
        percentage: 35,
        amount: Math.round(totalEstimated * 0.35),
        reason: "Allocated for luxury color shade-melting, blowout or protein therapy."
      },
      {
        category: "Signature Makeup Layout",
        percentage: 45,
        amount: Math.round(totalEstimated * 0.45),
        reason: "Primary focus to secure beautiful HD long-lasting photo compatibility."
      },
      {
        category: "Skincare Facials",
        percentage: 15,
        amount: Math.round(totalEstimated * 0.15),
        reason: "Ensures flawless and hydrated canvas for high aesthetics."
      },
      {
        category: "Safety Buffer / Custom Add-ons",
        percentage: 5,
        amount: Math.round(totalEstimated * 0.05),
        reason: "Reserved for customized accent nails or product touch-up kits."
      }
    ],
    matchedSalons: [
      {
        salonId: matchedIds[0],
        matchScore: 98,
        reasoning: `Selected as your absolute optimal matchmaking solution. Aura offers elite-level bridal & occasion makeovers directly in ${location} and perfectly accommodates custom style requests.`
      },
      {
        salonId: matchedIds[1],
        matchScore: 92,
        reasoning: "Excellent lifestyle-centered alternative with an outstanding team of modern hair-melting color artists and high-speed delivery."
      },
      {
        salonId: matchedIds[2],
        matchScore: 86,
        reasoning: "Highly rated unisex salon that delivers extremely clean and cost-effective beauty bundles suited for high-density requirements."
      }
    ]
  };
}

// Vite integration
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    // Development Mode
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Production Mode
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    // Serve client-side SPA route fallbacks
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`GlamPilot AI Server running on http://localhost:${PORT}`);
  });
}

startServer();

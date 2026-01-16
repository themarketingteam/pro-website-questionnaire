// Pro Website Questionnaire Data
export const SERVICE_OPTIONS_GROUPED = {
  "Managed IT Services": [
    "Managed IT",
    "Co-Managed IT",
    "Remote Monitoring & Management (RMM)",
    "IT Asset Management",
    "On-Site Support"
  ],
  "IT Support Services": [
    "IT Help Desk",
    "Outsourced IT Help Desk",
    "Hourly IT Support",
    "IT Consulting"
  ],
  "Cloud Solutions": [
    "Cloud Services",
    "Hybrid Cloud Services",
    "Private Cloud Services",
    "Cloud Migrations",
    "Azure Services",
    "Google Workspace",
    "Cloud Storage",
    "Virtual Desktop Infrastructure (VDI)",
    "Cloud Cost Optimization"
  ],
  "Modern Workplace & Productivity Solutions": [
    "Microsoft 365",
    "Internet Services"
  ],
  "Cybersecurity Services": [
    "Cybersecurity",
    "MDR (Managed Detection & Response)",
    "EDR (Endpoint Detection & Response)",
    "Email Security",
    "Vulnerability Scanning",
    "Penetration Testing",
    "Dark Web Monitoring",
    "SOC Services",
    "Security Awareness Training",
    "Ransomware Removal"
  ],
  "Compliance & Regulatory Services": [
    "CMMC Compliance",
    "FTC Compliance",
    "HIPAA Compliance",
    "IT Compliance",
    "NIST Framework Compliance",
    "PCI Compliance",
    "SOC 2 Compliance",
    "Compliance Gap Assessments",
    "GRC Program Management",
    "Policy Documentation"
  ],
  "Network & Infrastructure Services": [
    "Network Design & Implementation",
    "Wi-Fi / Wireless Solutions",
    "Server Installation & Management",
    "Firewall & Network Security Appliances",
    "Structured Cabling",
    "Printer & Office Machine",
    "Hardware Procurement",
    "Lifecycle Management"
  ],
  "Business Continuity Services": [
    "Business Continuity Planning",
    "High-Availability Solutions",
    "Backup Monitoring & Management"
  ],
  "Data Backup & Disaster Recovery Services": [
    "Data Backup & Recovery",
    "Disaster Recovery Planning",
    "Offsite / Cloud Backups",
    "Hardware as a Service"
  ],
  "Physical Security Solutions": [
    "Video Surveillance Solutions",
    "Access Control Systems",
    "Smart Building / IoT Security",
    "Alarm System Integration"
  ]
};

export const SERVICE_OPTIONS = Object.values(SERVICE_OPTIONS_GROUPED).flat();

export const INDUSTRY_OPTIONS = [
  "Agriculture / Farming",
  "Dental Practices",
  "Energy / Oil & Gas",
  "Engineering / Architecture Firms",
  "Financial / Accounting / CPA",
  "Government / Municipalities",
  "Healthcare / Medical",
  "Insurance Agencies",
  "Legal Firms",
  "Manufacturing / Construction",
  "Nonprofits / Education",
  "Professional Services (Marketing, Real Estate, etc.)",
  "Real Estate / Property Management",
  "Retail / Hospitality",
  "Technology / SaaS Companies",
  "Transportation / Logistics"
];

export const DELIVERY_MODEL_OPTIONS = [
  "Fully Managed IT Provider",
  "Co-Managed IT (internal IT support partnership)",
  "Project-Based IT Consulting",
  "Break-Fix / On-Demand Support",
  "Virtual CIO / Strategic Advisory"
];

export const PRICING_MODEL_OPTIONS = [
  "Per-user pricing",
  "Per-device pricing",
  "Flat-rate monthly service packages",
  "Tiered service packages",
  "Hourly / Project-based billing",
  "Custom / Hybrid pricing models"
];

export const COMPANY_GOALS_OPTIONS = [
  "Increase recurring revenue",
  "Modernize marketing and brand image",
  "Improve client retention",
  "Expand into new markets or regions",
  "Add new service offerings",
  "Attract higher-value clients",
  "Reduce client churn",
  "Build thought leadership and authority"
];

export const BRAND_VOICE_OPTIONS = [
  "Professional & Corporate",
  "Friendly & Approachable",
  "Technical & Expert-Driven",
  "Modern & Innovative",
  "Confident & Authoritative Expert",
  "High-End & Premium",
  "Story-Driven & Mission-Focused"
];

export const CLIENT_ACQUISITION_OPTIONS = [
  "Referrals / Word of Mouth",
  "Google Search / SEO",
  "Paid Advertising (Google Ads, Facebook)",
  "Social Media / LinkedIn",
  "Networking / Events / Conferences",
  "Vendor or Partner Referrals",
  "Cold Outreach / Outbound Sales"
];

export const WEBSITE_OBJECTIVES_OPTIONS = [
  "Generate qualified leads",
  "Strengthen credibility and authority",
  "Educate and build trust",
  "Support the sales process",
  "Attract top talent / recruiting",
  "Showcase case studies and results"
];

export const BUSINESS_SIZE_OPTIONS = [
  "1–10 employees",
  "10–25 employees",
  "26–50 employees",
  "51–100 employees",
  "101–250 employees",
  "250+ employees"
];

export const CLIENT_PROBLEMS_OPTIONS = [
  "Frequent downtime or outages",
  "Security incidents or data loss",
  "Lack of IT strategy or planning",
  "Poor responsiveness from current provider",
  "Rising IT costs / budget unpredictability",
  "Compliance concerns (HIPAA, SOC 2, etc.)",
  "Outdated technology / infrastructure",
  "Staff productivity issues"
];

export const CLIENT_OUTCOMES_OPTIONS = [
  "Reliable systems and less downtime",
  "Stronger cybersecurity posture",
  "Predictable monthly costs",
  "Strategic IT planning and guidance",
  "Improved staff productivity",
  "Compliance confidence",
  "Faster response times"
];

export const DECISION_MAKERS_OPTIONS = [
  "Business Owner / CEO",
  "IT Manager / Director",
  "Office Manager / Operations Manager",
  "CFO / Finance Director",
  "Practice Manager (for healthcare/legal)",
  "Board of Directors / Partners"
];

export const PRIMARY_CTA_OPTIONS = [
  "Schedule a Consultation",
  "Request a Quote",
  "Call Us Directly",
  "Get a Free Assessment",
  "Download a Resource / Guide"
];

export const QUESTIONS = [
  // Section: Additional Page Options
  {
    id: "1",
    section: "Additional Page Options",
    title: "Would you like to include a dedicated 'Why Choose Us' page on your website?",
    why: "This question determines whether your website will include a trust-building page focused entirely on your company's differentiators, strengths, and credibility markers. The presence or absence of this page impacts your sitemap, navigation layout, and the structure of your homepage and About page messaging.",
    guidance: "Select 'Yes' if you want a standalone page that highlights the reasons a prospective client should choose your MSP over another. This page typically includes differentiators, methodologies, philosophies, guarantees, and proof points. Selecting 'No' means these elements will only appear in smaller modules on other pages instead of a dedicated page.",
    type: "yes_no",
    examples: { yes: "Yes, we want a Why Choose Us page.", no: "No, we do not want this page." },
    conditionalChildren: [
      {
        id: "1.1",
        title: "Describe what sets your business apart from competitors.",
        why: "This description is used to create the core narrative of the Why Choose Us page. It shapes the messaging tone, informs the lead-in hero section, and influences the proof-based elements that demonstrate why your MSP is the best choice.",
        guidance: "Provide a detailed explanation of your primary differentiators. These could include response-time guarantees, proprietary processes, team expertise, client service philosophy, onboarding methods, unique toolsets, or anything that meaningfully separates you from local competitors. Write in full sentences to help us shape compelling, high-converting content.",
        type: "textarea",
        requiredIfParentYes: true,
        examples: { shortAnswer: "We offer a 10-minute response guarantee, operate with a fully documented process library, and provide a dedicated vCIO to every client. Our approach emphasizes proactive security, transparent billing, and measurable outcomes." }
      },
      {
        id: "1.2",
        title: "Do you have any certifications, awards, or partnerships that you would like to highlight?",
        why: "These elements are powerful trust signals for your Why Choose Us page. They establish credibility and authority, helping differentiate you from competitors.",
        guidance: "Select 'Yes' if you have certifications, vendor partnerships, awards, or other credentials to showcase on your Why Choose Us page.",
        type: "yes_no",
        requiredIfParentYes: false,
        examples: { yes: "Yes, we have certifications or awards to highlight.", no: "No, we do not have any to highlight." },
        conditionalChildren: [
          {
            id: "1.2.1",
            title: "Add your certifications, accolades, awards, or partnerships",
            why: "Adding specific details helps us showcase your credentials effectively on your Why Choose Us page.",
            guidance: "For each item, provide the name, type, and optionally include images or supporting documentation. These entries are shared with Question 12.1, so any changes here will be reflected there and vice versa.",
            type: "multi_certification",
            requiredIfParentYes: false,
            limits: { min: 0, max: 10 }
          }
        ]
      }
    ]
  },
  {
    id: "2",
    section: "Additional Page Options",
    title: "Would you like to include a 'Meet the Team' page on your website?",
    why: "This question determines whether your website will feature a team-focused page to humanize your company and build trust with prospects. A Meet the Team page can significantly improve conversions by showing the people behind the service.",
    guidance: "Select 'Yes' if you want a dedicated page showcasing your team, including staff roles, bios, and a team photo. This page is valuable for relationship-driven MSPs or companies targeting industries where personal trust is a major decision factor. Select 'No' if you prefer not to feature team members individually or do not have team imagery available.",
    type: "yes_no",
    examples: { yes: "Yes, we want a Meet the Team page.", no: "No, we do not want this page." },
    conditionalChildren: [
      {
        id: "2.1",
        title: "Provide an overview introduction for your team.",
        why: "This introduction forms the opening paragraph of your Meet the Team page and gives the visitor context about your team culture, values, structure, and strengths. A strong introduction significantly increases engagement and trust.",
        guidance: "Write two to five sentences describing your team as a whole. You can mention tenure, diversity of expertise, leadership philosophy, internal culture, or anything that reflects who you are as a team. Avoid listing individual bios here; the purpose is to introduce the group.",
        type: "textarea",
        requiredIfParentYes: true,
        examples: { shortAnswer: "Our team is composed of seasoned IT professionals with decades of combined experience. We emphasize proactive support, continuous improvement, and a collaborative culture that keeps clients confident and protected." }
      },
      {
        id: "2.2",
        title: "Upload a team photo and tag each person.",
        why: "A high-quality team photo with tagged team members adds authenticity and is a centerpiece of the Meet the Team page. This element improves user trust and signals professionalism.",
        guidance: "Upload the highest-quality version available of your team photo. After uploading, you'll be able to click on each person in the photo to add their name, position/role, and bio. The system will automatically order them from left to right and top to bottom.",
        type: "image_tagging",
        requiredIfParentYes: true,
        examples: { fileTypes: ["jpg", "jpeg", "png"], notes: "Upload an image, then click to tag each team member with their details." }
      }
    ]
  },
  // Section: About Your Business
  {
    id: "3",
    section: "About Your Business",
    title: "What specific IT services and solutions do you provide?",
    why: "Your service selections directly determine which service pages are generated, how your navigation is structured, and which SEO opportunities are prioritized. This ensures the site focuses on what you actually sell and positions you correctly in the market.",
    guidance: "Select the core services that represent your active offerings—not every service you've ever provided. Choose the areas where you have meaningful expertise or where you want to grow. You must choose between 3 and 15 items, and the combined total with Q4 and Q5 must fall between 8 and 20.",
    type: "checkbox",
    options: SERVICE_OPTIONS,
    showOther: true,
    limits: { min: 3, max: 15 },
    isSpanQuestion: true,
    examples: { selections: ["Managed IT Services / Help Desk", "Cybersecurity & Threat Protection", "Microsoft 365 / Cloud Management"], other: "IT Compliance Consulting (HIPAA, SOC 2)" }
  },
  {
    id: "4",
    section: "About Your Business",
    title: "What industries do you specialize in supporting?",
    why: "Industry selection determines the Industry pages generated and helps us tailor messaging to the unique challenges of your target verticals. Industry alignment is one of the strongest differentiators for MSPs and is often a major factor in lead quality.",
    guidance: "Select the industries where you have real experience or strategic intention. These should be industries you actively target or where you have case studies, strong knowledge, or repeat clients. Minimum of 1 and maximum of 10 selections. Total combined with Q3, Q4, and Q5 must be between 8 and 20.",
    type: "checkbox",
    options: INDUSTRY_OPTIONS,
    showOther: true,
    limits: { min: 1, max: 10 },
    isSpanQuestion: true,
    examples: { selections: ["Healthcare / Medical", "Financial / Accounting / CPA", "Manufacturing / Construction"], other: "Real Estate and Property Management" }
  },
  {
    id: "5",
    section: "About Your Business",
    title: "What are your service cities or geological regions of service?",
    why: "Your geographic focus determines whether we generate location-specific SEO pages and how local or national your messaging should be. This affects local SEO, Google Business Profile optimization, and how we describe your service footprint throughout the site. Selecting specific cities or towns yields the best SEO results compared to broad selections like states or countries.",
    guidance: "Select 1 to 5 validated locations using the search field. For optimal SEO performance, we strongly recommend choosing specific cities or towns rather than states or countries. Each validated location will count toward your total selection balance. Continents are not allowed. Must be between 1 and 5 validated entries. Combined total with Q3, Q4, and Q5 must be between 8 and 20.",
    type: "multi_text",
    limits: { min: 1, max: 5 },
    isSpanQuestion: true,
    examples: { entries: ["Nashville, TN", "Brentwood, TN"] }
    },
    {
    id: "6",
    section: "About Your Business",
    title: "In your own words, explain what your company does and who it helps, as if you were speaking to someone with no IT background.",
    why: "This concise description informs the top-level messaging for the homepage hero section, About page introduction, and metadata language. It helps establish your positioning and communicates your value in a high-level, client-friendly format.",
    guidance: "Provide a short summary that clearly states what your company does and who you serve. Focus on your specialization, geographic focus, or core differentiators. Avoid long lists or technical jargon—this should be polished, brand-ready language.",
    type: "textarea",
    examples: { shortAnswer: "Our company helps small and mid-sized businesses take the stress out of their technology so they can focus on running their business. We work with companies that rely on computers, email, and the internet every day but don't have the time or expertise to manage those systems themselves. We handle things like keeping their devices secure, making sure their data is backed up, fixing issues when something breaks, and helping their teams work more efficiently. Our goal is to be a reliable partner that prevents problems before they happen and explains everything in a clear, non-technical way." }
    },
    {
    id: "7",
    section: "About Your Business",
    title: "How do you typically deliver your services?",
    why: "Your delivery model determines your service positioning and how we write your offer structure. This influences pricing language, expectations, CTA blocks, and the way we describe your working relationship with clients.",
    guidance: "Select the primary delivery model that accurately describes how clients engage with your MSP. Choose based on what you actively sell—not models you used historically but no longer offer.",
    type: "radio",
    options: DELIVERY_MODEL_OPTIONS,
    showOther: true,
    examples: { selection: "Fully Managed IT Provider" }
  },
  {
    id: "8",
    section: "About Your Business",
    title: "What best describes your pricing or engagement model?",
    why: "Pricing structure is a major trust indicator for prospects and helps us frame expectations when writing the Pricing, Services, and CTA sections. It also guides the tone—whether you're positioned as premium, flexible, standardized, or customizable.",
    guidance: "Select all pricing models you actively use. For example, some MSPs offer flat-rate per-user pricing for managed clients but use hourly billing for special projects. Select the models that reflect your current and intended engagement structure.",
    type: "checkbox",
    options: PRICING_MODEL_OPTIONS,
    showOther: true,
    limits: { min: 1, max: 3 },
    examples: { selections: ["Per-user pricing", "Flat-rate monthly service packages"] }
  },
  {
    id: "9",
    section: "About Your Business",
    title: "What makes your MSP different from others in your area?",
    why: "This is the foundation of your competitive positioning and is used on multiple pages: Home, About, Why Choose Us (if selected), and several service pages. It also guides SEO value statements, trust blocks, and conversion-focused copy.",
    guidance: "Describe the key differentiators that your ideal client would care about most. Examples include rapid response times, process discipline, compliance expertise, cybersecurity maturity, unique onboarding workflows, or customer experience philosophies. Be specific—avoid generic statements like 'we care more.'",
    type: "textarea",
    examples: { shortAnswer: "What sets us apart is our disciplined, process-driven approach combined with unusually fast and personal service. Every workflow we manage is fully documented, which means issues are resolved consistently and efficiently without relying on tribal knowledge. We back this up with a 10-minute response guarantee, so clients are never left wondering when help will arrive. In addition, each client is assigned a dedicated vCIO who provides strategic guidance, budgeting support, and quarterly reviews to ensure technology decisions align with business goals, compliance needs, and long-term growth." }
  },
  {
    id: "10",
    section: "About Your Business",
    title: "What are your company's top goals for the next 12–18 months?",
    why: "Your goals shape your site's tone and focus. An MSP trying to build credibility needs different messaging than one focusing on scaling MRR or entering new verticals. This question directly influences CTA strategy and strategic content placement.",
    guidance: "Select up to three goals that represent your highest business priorities. These should reflect what you want your website and marketing to help you achieve. Avoid selecting every option—focus on what matters most.",
    type: "checkbox",
    options: COMPANY_GOALS_OPTIONS,
    showOther: true,
    limits: { min: 1, max: 3 },
    examples: { selections: ["Increase recurring revenue", "Modernize marketing and brand image", "Improve client retention"] }
  },
  {
    id: "11",
    section: "About Your Business",
    title: "How would you describe your brand voice?",
    why: "Brand voice determines tone, writing style, and how we present your MSP's personality. The selected voice affects headlines, call-to-action language, and the way we frame your value throughout the site.",
    guidance: "Choose the voice that best aligns with how you want prospects to perceive you. If your company culture is casual and friendly, select a conversational voice. If you serve regulated industries, a more authoritative tone may be appropriate.",
    type: "radio",
    options: BRAND_VOICE_OPTIONS,
    showOther: true,
    examples: { selection: "Professional and authoritative" }
  },
  {
    id: "12",
    section: "About Your Business",
    title: "Do you have any certifications, awards, or partnerships that you would like to highlight?",
    why: "Highlighting official recognitions, partnerships with major vendors, and certifications establishes credibility and authority.",
    guidance: "These elements are powerful trust signals that can differentiate you from competitors.",
    examples: { yes: "Yes, we have certifications or awards to highlight.", no: "No, we do not have any to highlight." },
    type: "yes_no",
    conditionalChildren: [
      {
        id: "12.1",
        title: "Add your certifications, accolades, awards, or partnerships",
        why: "Adding specific details helps us showcase your credentials effectively.",
        guidance: "For each item, provide the name, type, and optionally include images or supporting documentation.",
        type: "multi_certification",
        requiredIfParentYes: true,
        limits: { min: 1, max: 10 }
      }
    ]
  },
  {
    id: "13",
    section: "About Your Business",
    title: "What does your sales or onboarding process look like?",
    why: "This allows us to construct a clear, client-friendly process section that explains exactly how prospects move from consultation to onboarding. It increases transparency and helps build trust.",
    guidance: "Describe the workflow a client experiences—typically 3–5 steps. Examples include consultation, assessment, proposal, onboarding, and ongoing support. If your process includes guarantees or follow-ups, include those details as well.",
    type: "textarea",
    examples: { shortAnswer: "Our process begins with an initial discovery call to understand the client's business, goals, and pain points. This is followed by a comprehensive technical assessment covering infrastructure, security, compliance, and workflows. We then present a tailored proposal outlining recommendations, timelines, and expectations. Once approved, we hold a kickoff meeting and complete onboarding over approximately 30 days. During onboarding, we document systems, optimize configurations, implement security improvements, and ensure a smooth transition with minimal disruption to daily operations." }
  },
  {
    id: "14",
    section: "About Your Business",
    title: "Do you have a specific guarantee or service standard?",
    why: "Guarantees help differentiate your MSP and reduce buyer friction. They function as high-impact trust elements and often appear in hero sections, CTA blocks, and the Why Choose Us page.",
    guidance: "Select 'Yes' if you offer response-time guarantees, uptime commitments, contract flexibility, satisfaction guarantees, or defined SLAs. Select 'No' if you do not have formal guarantees or service standards to highlight.",
    type: "yes_no",
    examples: { yes: "Yes, we have guarantees or service standards.", no: "No, we do not have formal guarantees." },
    conditionalChildren: [
      {
        id: "14.1",
        title: "Please add and describe your specific guarantee or service standard.",
        why: "Adding specific details helps us showcase your guarantees effectively throughout your website, building trust and differentiating you from competitors.",
        guidance: "For each guarantee or service standard, provide the name, select the type, and either upload a supporting file or provide a description. At least one of these (file or description) is required.",
        type: "multi_guarantee",
        requiredIfParentYes: true,
        limits: { min: 1, max: 10 }
      }
    ]
  },
  {
    id: "15",
    section: "About Your Business",
    title: "How do clients usually find you?",
    why: "This informs your website's funnel and helps emphasize the channels that already work. If referrals are your top source, your messaging should highlight client experience. If SEO drives leads, we may strengthen educational or resource-focused content.",
    guidance: "Select the primary acquisition channel that consistently produces leads. Choose the channel that represents your main source of new business today.",
    type: "radio",
    options: CLIENT_ACQUISITION_OPTIONS,
    showOther: true,
    examples: { selection: "Referrals / Word of Mouth" }
  },
  {
    id: "16",
    section: "About Your Business",
    title: "What do you want your website to achieve most?",
    why: "The primary business objective you select helps shape the homepage strategy, CTA placement, and the emphasis of your content. Sites built for lead generation behave differently from sites built for authority or education.",
    guidance: "Select up to three objectives that reflect your highest priorities. If your top goal is lead-generation, CTAs will be more prominent. If your focus is credibility, we will emphasize proof elements such as case studies, certifications, and differentiators.",
    type: "checkbox",
    options: WEBSITE_OBJECTIVES_OPTIONS,
    showOther: true,
    limits: { min: 1, max: 3 },
    examples: { selections: ["Generate qualified leads", "Strengthen credibility and authority", "Educate and build trust"] }
  },
  // Section: About Your Target Clients
  {
    id: "17",
    section: "About Your Target Clients",
    title: "What size businesses do you primarily support?",
    why: "Company size influences complexity, budget expectations, growth trajectory, and the scale of IT support required. This data helps us adjust your messaging—from SMB-focused to mid-market or enterprise-support positioning.",
    guidance: "Specify the range of business sizes you primarily support. Enter the smallest and largest company sizes by number of employees.",
    type: "numeric_range",
    minValue: 1,
    maxValue: 50,
    examples: { shortAnswer: "10-100 employees" }
  },
  {
    id: "18",
    section: "About Your Target Clients",
    title: "What common problems do clients experience before hiring you?",
    why: "This question identifies your prospects' pain points, which helps create a strong connection with visitors by immediately addressing the issues they are actively facing. It impacts the Home page stakes section, service page intros, and trust-building copy.",
    guidance: "Select the top recurring problems clients share when they first contact you. Choose issues you can solve exceptionally well and that resonate with your ICP. Select up to 3. These will be used to frame your problem–solution narrative.",
    type: "checkbox",
    options: CLIENT_PROBLEMS_OPTIONS,
    showOther: true,
    limits: { min: 1, max: 3 },
    examples: { selections: ["Frequent downtime or outages", "Security incidents or data loss", "Lack of IT strategy or planning"] }
  },
  {
    id: "19",
    section: "About Your Target Clients",
    title: "What are the biggest frustrations your clients express?",
    why: "Understanding client frustrations helps create empathetic messaging that connects emotionally with prospects. It improves the resonance of your brand voice and is used to position your MSP as the solution to their negative past experiences.",
    guidance: "Write the common frustrations prospects share during sales calls or onboarding. Examples include poor responsiveness from previous providers, confusing communication, lack of transparency, or reactive-only IT support. Provide real language whenever possible.",
    type: "textarea",
    examples: { shortAnswer: "Many of our clients come to us frustrated by their previous MSP experiences. They commonly report slow response times, unclear escalation paths, and a lack of transparency around what work was actually being performed. Clients often felt reactive support was the norm, with problems recurring instead of being permanently resolved. Others express frustration with poor communication, technical jargon without explanation, and no clear roadmap for improving security or reliability. These pain points are typically what drive clients to seek a more proactive, accountable IT partner." }
  },
  {
    id: "20",
    section: "About Your Target Clients",
    title: "What results or outcomes do your clients want most?",
    why: "Identifying desired outcomes helps us focus your value propositions around measurable wins and aspirational benefits. These insights drive your benefit-focused messaging throughout the site, especially on your homepage and service pages.",
    guidance: "Select up to 3 outcomes that reflect what your clients most commonly want from IT support. These may include reliability, security, reduced downtime, predictable costs, or long-term strategy. Focus on the outcomes that align best with your strengths.",
    type: "checkbox",
    options: CLIENT_OUTCOMES_OPTIONS,
    showOther: true,
    limits: { min: 1, max: 3 },
    examples: { selections: ["Reliable systems and less downtime", "Stronger cybersecurity posture", "Predictable monthly costs"] }
  },
  {
    id: "21",
    section: "About Your Target Clients",
    title: "What words or phrases do clients typically use to describe your value?",
    why: "This question provides real client language that can shape testimonials, trust-building statements, and tone. Using your clients' own words significantly boosts authenticity and conversion rates.",
    guidance: "List actual phrases you've heard from satisfied clients—comments about reliability, responsiveness, friendliness, expertise, accountability, or peace of mind. Provide direct quotes if possible. These will be incorporated into voice-of-customer copy.",
    type: "textarea",
    examples: { shortAnswer: "Clients frequently describe us as reliable, proactive, and easy to work with. They value our fast response times, consistent follow-through, and clear communication that avoids unnecessary technical jargon. Many clients say they appreciate knowing exactly what is being done and why, rather than feeling kept in the dark. We are often described as a trusted partner rather than just a vendor, with clients highlighting our ability to prevent issues, improve stability, and help them make confident technology decisions that support their business." }
  },
  {
    id: "22",
    section: "About Your Target Clients",
    title: "Describe your ideal client in one or two sentences.",
    why: "This distills your ICP into a short statement that shapes your overall brand targeting strategy. It influences the site's tone, messaging, and which benefits are emphasized most prominently.",
    guidance: "Summarize the key traits of your ideal client—include their industry, size, IT maturity, personality traits, or business needs. This should be a clear and concise statement that reflects who you're trying to attract long-term.",
    type: "textarea",
    examples: { shortAnswer: "Our ideal clients are professional service organizations with approximately 25–100 employees that rely heavily on technology for daily operations. They value proactive IT management, strong security and compliance practices, clear communication, and a long-term partnership focused on stability, efficiency, and strategic planning rather than break-fix support." }
  },
  {
    id: "23",
    section: "About Your Target Clients",
    title: "Are there any industries or client types you prefer to avoid?",
    why: "This helps ensure your site does not attract leads that are unprofitable, high-risk, or outside your desired service areas. It also helps refine SEO and prevent misalignment between marketing and operational reality.",
    guidance: "Select 'Yes' if there are specific industries, business sizes, or client patterns you prefer not to target. Select 'No' if you serve all types of businesses without restriction.",
    type: "yes_no",
    examples: { yes: "Yes, there are client types we prefer to avoid.", no: "No, we serve all types of businesses." },
    conditionalChildren: [
      {
        id: "23.1",
        title: "Please list the industries or client types you do NOT serve.",
        why: "This detailed list helps us refine your site's messaging, SEO strategy, and lead qualification to ensure you attract only the right clients.",
        guidance: "List any industries, business sizes, or client patterns that you prefer not to target. Be honest—if certain clients drain resources or don't align with your expertise, we use this information to avoid attracting them.",
        type: "textarea",
        requiredIfParentYes: false,
        examples: { shortAnswer: "We typically do not serve restaurants, retail stores, or very small businesses with fewer than five employees. These environments often require highly transactional, on-demand support models or point-of-sale–centric systems that fall outside our proactive, standardized service framework. Our services are designed for organizations that benefit from structured processes, long-term planning, and consistent technology management rather than short-term or ad-hoc support needs." }
      }
    ]
  },
  {
    id: "24",
    section: "About Your Target Clients",
    title: "What is the #1 action you want website visitors to take?",
    why: "Identifying the primary CTA ensures that your site design supports your core business goal—whether it's generating consultations, quote requests, or direct calls. This affects button placement, top-level navigation, and funnel architecture.",
    guidance: "Select the most important action for new visitors. If you typically convert best through consultations, choose that. If your ICP prefers calling directly, choose a phone call CTA. Only choose one primary objective to maintain a clear and focused conversion path.",
    type: "radio",
    options: PRIMARY_CTA_OPTIONS,
    showOther: true,
    examples: { selection: "Schedule a Consultation" }
  },
  {
    id: "25",
    section: "About Your Target Clients",
    title: "Is there any additional information or requests that would help us write the content for your website?",
    why: "This final question captures details that may not fit neatly into other categories—such as special requirements, unique offerings, website restrictions, brand elements, or internal goals.",
    guidance: "Select 'Yes' if you have additional content instructions or information that would help us write better website copy. Select 'No' if you've covered everything.",
    type: "yes_no",
    examples: { yes: "Yes, I have additional content instructions.", no: "No, I've covered everything." },
    conditionalChildren: [
      {
        id: "25.1",
        title: "Please share your additional content instructions.",
        why: "This helps us capture any special requirements, unique offerings, or content preferences that will improve the quality of your website copy.",
        guidance: "Share any additional information about your business, special requirements, unique offerings, brand voice preferences, or content restrictions. This question is specifically about content, not design preferences.",
        type: "textarea",
        requiredIfParentYes: false,
        examples: { shortAnswer: "We prefer authentic, professional imagery that reflects our real team, office environment, and client interactions whenever possible. Please avoid generic stock photos that resemble call centers or overly staged IT environments. Ideal imagery includes our staff collaborating, working with clients, or engaging in real-world scenarios that convey trust, approachability, and professionalism. The goal is to present a genuine, human representation of our company rather than a generic or outsourced appearance." }
      }
    ]
  }
];
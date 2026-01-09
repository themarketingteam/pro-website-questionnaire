import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Send, Loader2 } from 'lucide-react';

export default function TestZapier() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [response, setResponse] = useState(null);

  const testPayload = {
    "metadata": {
      "business_name": "Test Company",
      "businessDomain": "test.com",
      "submission_datetime": new Date().toISOString(),
      "service_type": "pro"
    },
    "userdata": {
      "additional_pages_list": {
        "why_choose_us_page": { "generate_page": false, "why_choose_us_description": "" },
        "meet_the_team_page": { "generate_page": false, "team_introduction": "", "team_photo_with_tags": { "imageUrl": "", "taggedPeople": [] } }
      },
      "service_offerings": ["Managed IT", "Cybersecurity"],
      "service_offerings_other": "",
      "target_industries": ["Healthcare / Medical"],
      "target_industries_other": "",
      "geographic_areas": [],
      "company_description": "Test description",
      "delivery_model": "Fully Managed IT Provider",
      "delivery_model_other": "",
      "pricing_packaging": ["Per-user pricing"],
      "pricing_packaging_other": "",
      "differentiation": "Test differentiation",
      "company_goals": ["Increase recurring revenue"],
      "company_goals_other": "",
      "brand_tone": "Professional & Corporate",
      "brand_tone_other": "",
      "certifications_partnerships": [],
      "sales_process": "Test sales process",
      "service_guarantee": false,
      "service_guarantee_items": [],
      "client_acquisition": "Referrals / Word of Mouth",
      "client_acquisition_other": "",
      "website_objectives": ["Generate qualified leads"],
      "website_objectives_other": "",
      "client_size": "1-100 employees",
      "client_challenges": ["Frequent downtime or outages"],
      "client_challenges_other": "",
      "client_frustrations": "Test frustrations",
      "client_outcomes": ["Reliable systems and less downtime"],
      "client_outcomes_other": "",
      "value_description": "Test value description",
      "ideal_client": "Test ideal client",
      "avoided_clients": "",
      "primary_cta": "Schedule a Consultation",
      "primary_cta_other": "",
      "additional_notes": ""
    }
  };

  const handleTest = async () => {
    setIsSubmitting(true);
    setResponse(null);

    try {
      console.log('📤 Sending test payload to Zapier...');
      const result = await base44.functions.invoke('sendToZapier', testPayload);
      
      console.log('✅ Response:', result.data);
      setResponse(result.data);
      toast.success('Successfully sent to Zapier!');
    } catch (error) {
      console.error('❌ Error:', error);
      setResponse({ error: error.message });
      toast.error('Failed to send to Zapier');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Test Zapier Integration</h1>
        
        <div className="bg-white rounded-lg shadow-md p-6 space-y-6">
          <div>
            <h2 className="text-xl font-semibold mb-4">Quick Test</h2>
            <p className="text-gray-600 mb-4">
              Click the button below to send a test payload to Zapier without filling out the form.
            </p>
            
            <Button
              onClick={handleTest}
              disabled={isSubmitting}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  Send Test Data to Zapier
                </>
              )}
            </Button>
          </div>

          {response && (
            <div className="border-t pt-6">
              <h3 className="font-semibold mb-2">Response:</h3>
              <pre className="bg-gray-100 p-4 rounded overflow-auto text-sm">
                {JSON.stringify(response, null, 2)}
              </pre>
            </div>
          )}

          <div className="border-t pt-6">
            <h3 className="font-semibold mb-2">Test Payload:</h3>
            <pre className="bg-gray-100 p-4 rounded overflow-auto text-sm max-h-96">
              {JSON.stringify(testPayload, null, 2)}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
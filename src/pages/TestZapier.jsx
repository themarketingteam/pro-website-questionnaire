import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Send, Loader2 } from 'lucide-react';
import ThankYouModal from '@/components/pro-form/ThankYouModal';

export default function TestZapier() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [response, setResponse] = useState(null);
  const [showThankYou, setShowThankYou] = useState(false);

  // Mock form data structure that matches what ProQuestionnaire passes
  const mockFormData = {
    '1': 'yes',
    '1.1': 'We differentiate ourselves through exceptional customer service and 24/7 support.',
    '2': 'no',
    '3': ['Managed IT', 'Cybersecurity'],
    '3_other': [],
    '4': ['Healthcare / Medical'],
    '4_other': [],
    '5': [],
    '6': 'Test Company is a leading provider of managed IT services with over 10 years of experience.',
    '7': 'Fully Managed IT Provider',
    '8': ['Per-user pricing'],
    '9': 'We provide comprehensive solutions with a focus on proactive maintenance.',
    '10': ['Increase recurring revenue'],
    '11': 'Professional & Corporate',
    '12': 'no',
    '13': 'Our sales process involves initial consultation, needs assessment, and custom proposal.',
    '14': 'no',
    '15': 'Referrals / Word of Mouth',
    '16': ['Generate qualified leads'],
    '17': '1-100 employees',
    '18': ['Frequent downtime or outages'],
    '19': 'Clients struggle with unreliable systems and lack of technical support.',
    '20': ['Reliable systems and less downtime'],
    '21': 'We deliver value through proactive monitoring and rapid response times.',
    '22': 'Small to medium businesses in healthcare seeking reliable IT support.',
    '23': 'no',
    '24': 'Schedule a Consultation',
    '25': 'no'
  };

  const testPayload = {
    "metadata": {
      "business_name": "Test Company",
      "businessDomain": "test.com",
      "submission_datetime": new Date().toISOString(),
      "service_type": "pro"
    },
    "userdata": {
      "additional_pages_list": {
        "why_choose_us_page": { "generate_page": true, "why_choose_us_description": "We differentiate ourselves through exceptional customer service and 24/7 support." },
        "meet_the_team_page": { "generate_page": false, "team_introduction": "", "team_photo_with_tags": { "imageUrl": "", "taggedPeople": [] } }
      },
      "service_offerings": ["Managed IT", "Cybersecurity"],
      "service_offerings_other": "",
      "target_industries": ["Healthcare / Medical"],
      "target_industries_other": "",
      "geographic_areas": [],
      "company_description": "Test Company is a leading provider of managed IT services with over 10 years of experience.",
      "delivery_model": "Fully Managed IT Provider",
      "delivery_model_other": "",
      "pricing_packaging": ["Per-user pricing"],
      "pricing_packaging_other": "",
      "differentiation": "We provide comprehensive solutions with a focus on proactive maintenance.",
      "company_goals": ["Increase recurring revenue"],
      "company_goals_other": "",
      "brand_tone": "Professional & Corporate",
      "brand_tone_other": "",
      "certifications_partnerships": [],
      "sales_process": "Our sales process involves initial consultation, needs assessment, and custom proposal.",
      "service_guarantee": false,
      "service_guarantee_items": [],
      "client_acquisition": "Referrals / Word of Mouth",
      "client_acquisition_other": "",
      "website_objectives": ["Generate qualified leads"],
      "website_objectives_other": "",
      "client_size": "1-100 employees",
      "client_challenges": ["Frequent downtime or outages"],
      "client_challenges_other": "",
      "client_frustrations": "Clients struggle with unreliable systems and lack of technical support.",
      "client_outcomes": ["Reliable systems and less downtime"],
      "client_outcomes_other": "",
      "value_description": "We deliver value through proactive monitoring and rapid response times.",
      "ideal_client": "Small to medium businesses in healthcare seeking reliable IT support.",
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
      const result = await base44.functions.invoke('sendToZapier', testPayload);
      const data = result.data;
      setResponse(data);
      if (data?.success === false) {
        toast.error(data?.message || 'Zapier delivery failed');
      } else if (data?.suppressed) {
        toast.info('External delivery was suppressed by environment policy.');
      } else if (data?.redirected) {
        toast.success('Test data was delivered to the staging destination.');
      } else if (data?.delivered) {
        toast.success('Data was delivered to the production destination.');
      } else {
        toast.info('No external delivery was reported.');
      }
    } catch (error) {
      console.error('[TestZapier] Staging delivery failed.');
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

          <div className="border-t pt-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">Thank You Page Preview:</h3>
              <Button
                onClick={() => setShowThankYou(!showThankYou)}
                variant="outline"
                size="sm"
              >
                {showThankYou ? 'Hide Preview' : 'Show Preview'}
              </Button>
            </div>
            
            {showThankYou && (
              <div className="border border-gray-300 rounded-lg overflow-hidden" style={{ height: '600px' }}>
                <div className="relative w-full h-full">
                  <ThankYouModal 
                    businessName="Test Company"
                    domain="test.com"
                    formData={mockFormData}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

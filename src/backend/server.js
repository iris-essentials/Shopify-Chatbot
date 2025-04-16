const express = require('express');
const dotenv = require('dotenv');
const path = require('path');
const cors = require('cors');
const { shopifyApi, LATEST_API_VERSION } = require('@shopify/shopify-api');
const { restResources } = require('@shopify/shopify-api/rest/admin/2023-07');
const { shopifyApiProject } = require('@shopify/shopify-api/adapters/node');
const axios = require('axios'); // Add axios for API requests

// Load environment variables from the root directory
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Initialize Shopify API client with error handling
let shopify;
try {
  // Log environment variables for debugging (remove in production)
  console.log('API Key:', process.env.SHOPIFY_API_KEY ? 'Present' : 'Missing');
  console.log('API Secret:', process.env.SHOPIFY_API_PASSWORD ? 'Present' : 'Missing');
  console.log('Shop URL:', process.env.SHOPIFY_SHOP_URL);
  console.log('Access Token:', process.env.SHOPIFY_ACCESS_TOKEN ? 'Present' : 'Missing');
  
  if (!process.env.SHOPIFY_API_KEY || !process.env.SHOPIFY_API_PASSWORD || !process.env.SHOPIFY_SHOP_URL) {
    throw new Error('Missing required environment variables. Check your .env file.');
  }
  
  const shopUrl = new URL(process.env.SHOPIFY_SHOP_URL);
  
  shopify = shopifyApi({
    apiKey: process.env.SHOPIFY_API_KEY,
    apiSecretKey: process.env.SHOPIFY_API_PASSWORD,
    scopes: ['read_products'],
    hostName: shopUrl.hostname,
    apiVersion: process.env.SHOPIFY_API_VERSION || LATEST_API_VERSION,
    isEmbeddedApp: false,
    adminApiAccessToken: process.env.SHOPIFY_ACCESS_TOKEN,
    customShopifyDomain: shopUrl.hostname,
    // Add the adapter for Node.js
    logger: { level: 0 },
    restResources,
    // Specify the adapter for Node.js
    customAdapterOptions: { adapter: shopifyApiProject }
  });
} catch (error) {
  console.error('Failed to initialize Shopify API:', error);
  process.exit(1);
}

const app = express();
app.use(express.json());
app.use(cors()); // Add CORS middleware

// Error handler middleware
const errorHandler = (err, req, res, next) => {
  console.error('Error:', err.stack);
  res.status(err.status || 500).json({
    error: {
      message: err.message || 'Internal Server Error',
      status: err.status || 500
    }
  });
};

// Health check endpoint with error handling
app.get('/api/health', (req, res, next) => {
  try {
    res.json({ 
      status: 'ok',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

// Test Shopify connection endpoint
app.get('/api/test-connection', async (req, res, next) => {
  try {
    if (!shopify) {
      throw new Error('Shopify client not initialized');
    }

    const client = new shopify.clients.Rest({
      session: {
        accessToken: process.env.SHOPIFY_ACCESS_TOKEN,
        shop: new URL(process.env.SHOPIFY_SHOP_URL).hostname
      }
    });
    
    // Fetch shop information
    const shopInfo = await client.get({
      path: 'shop'
    });
    
    // Fetch a small number of products
    const products = await client.get({
      path: 'products',
      query: { limit: 3 }
    });
    
    res.json({
      status: 'success',
      connection: 'Shopify connection successful',
      shop: shopInfo.body.shop,
      productCount: products.body.products.length,
      sampleProducts: products.body.products.map(p => ({
        id: p.id,
        title: p.title,
        handle: p.handle
      }))
    });
  } catch (error) {
    console.error('Shopify connection test failed:', error);
    if (error.response) {
      // Shopify API error
      return res.status(error.response.status || 500).json({
        status: 'error',
        connection: 'Shopify connection failed',
        error: {
          message: error.response.body?.errors || error.message,
          status: error.response.status,
          type: 'ShopifyAPIError'
        }
      });
    }
    next(error);
  }
});

// Helper function to call LLM API
// Remove this duplicate axios require statement
// const axios = require('axios'); // Ensure axios is required in the file where this function resides

// Helper function to call LLM API
async function callLLM(prompt, context = {}) {
  // Check if required LLM environment variables are set
  if (!process.env.LLM_API_KEY || !process.env.LLM_PROVIDER) {
    console.warn('LLM environment variables (LLM_API_KEY, LLM_PROVIDER) not set. LLM call skipped.');
    return null; // No LLM configured, return null to use fallback logic
  }

  try {
    const provider = process.env.LLM_PROVIDER.toLowerCase();
    // Use the specific model from .env if provided, otherwise use a sensible default per provider
    const model = process.env.LLM_MODEL;
    const apiKey = process.env.LLM_API_KEY;

    console.log(`Calling LLM Provider: ${provider}, Model: ${model || 'default specified by provider logic'}`);

    // Structure the messages for consistency (can be adjusted per API)
    const systemMessage = `You are a helpful shopping assistant for Iris Essentials. Use the following context to answer the customer's question: ${JSON.stringify(context)}`;
    const userMessage = prompt;

    let requestConfig; // To hold the Axios request configuration

    // --- OpenAI Configuration ---
    if (provider === 'openai') {
      requestConfig = {
        method: 'post',
        url: 'https://api.openai.com/v1/chat/completions',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        data: {
          model: model || 'gpt-3.5-turbo', // Default to gpt-3.5-turbo if LLM_MODEL is not set
          messages: [
            { role: 'system', content: systemMessage },
            { role: 'user', content: userMessage }
          ],
          temperature: 0.7, // Adjust creativity (0-1)
          max_tokens: 500 // Adjust max response length
        }
      };
    }
    // --- Anthropic Configuration ---
    else if (provider === 'anthropic') {
      requestConfig = {
        method: 'post',
        url: 'https://api.anthropic.com/v1/messages',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01' // Use the recommended version
        },
        data: {
          model: model || 'claude-3-sonnet-20240229', // Default to a recent Claude model if LLM_MODEL not set
          messages: [
             // Anthropic prefers the system prompt within the user message structure or via a system parameter
             { role: 'user', content: `${systemMessage}\n\nCustomer question: ${userMessage}` }
          ],
          max_tokens: 500, // Adjust max response length
          temperature: 0.7, // Adjust creativity
        }
      };
       // Optional: Anthropic also supports a top-level 'system' parameter
       // data.system = systemMessage; // If using this, adjust the user message content
    }
    // --- Gemini Configuration ---
    // --- Gemini Configuration ---
    else if (provider === 'gemini') {
      // Use the specific model name from .env directly, or default to 'gemini-pro'
      const modelIdentifier = model || 'gemini-pro';
      let geminiUrl;
      const geminiHeaders = { 'Content-Type': 'application/json' };

      // *** CHANGE: Use v1 endpoint and header key for gemini-pro ***
      // Use v1beta and query key for newer models (like 1.5) otherwise
      if (modelIdentifier === 'gemini-pro') {
          console.log(`Using v1 endpoint for stable model: ${modelIdentifier}`);
          geminiUrl = `https://generativelanguage.googleapis.com/v1/models/${modelIdentifier}:generateContent`;
          // v1 endpoint expects the API key in the header
          geminiHeaders['x-goog-api-key'] = apiKey;
      } else {
          // Assume v1beta for other potential models (e.g., gemini-1.5-pro-latest)
          console.log(`Using v1beta endpoint for model: ${modelIdentifier}`);
          geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelIdentifier}:generateContent?key=${apiKey}`;
          // v1beta endpoint typically uses the key in the query parameter
      }

      requestConfig = {
        method: 'post',
        url: geminiUrl, // Use the determined URL
        headers: geminiHeaders, // Use the determined headers
        data: {
          // Data payload remains the same
          contents: [{
            role: 'user',
            parts: [{ text: `${systemMessage}\n\nCustomer question: ${userMessage}` }]
          }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 500,
            // topP: 0.95,
            // topK: 40
          }
        }
      };
    }
    // --- Handle Unsupported Providers ---
    else {
      console.warn(`Unsupported LLM provider specified in .env: ${provider}`);
      return null;
    }

    // --- Make the API Call ---
    const response = await axios(requestConfig);

    // --- Extract Response Based on Provider ---
    if (provider === 'openai') {
      // Safely access nested properties
      return response.data?.choices?.[0]?.message?.content;
    } else if (provider === 'anthropic') {
      // Safely access nested properties
      return response.data?.content?.[0]?.text;
    } else if (provider === 'gemini') {
      // Safely access nested properties in Gemini's response structure
       const candidate = response.data?.candidates?.[0];
       const content = candidate?.content;
       const part = content?.parts?.[0];
       return part?.text;
    }

  } catch (error) {
    // Log detailed error information
    console.error(`Error calling ${process.env.LLM_PROVIDER} API:`);
    if (error.response) {
      // Log the response data if available (often contains specific API error messages)
      console.error('Status:', error.response.status);
      console.error('Headers:', JSON.stringify(error.response.headers, null, 2));
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      // Request was made but no response received
      console.error('Request Error: No response received.', error.request);
    } else {
      // Error setting up the request
      console.error('Request Setup Error:', error.message);
    }
    // Log the config that caused the error (mask API key if logging publicly)
    // console.error('Request Config:', JSON.stringify(error.config, null, 2));

    return null; // Return null to allow fallback to rule-based responses
  }

  // Should not be reached if provider is supported, but added for safety
  return null;
}

// Example Usage (within an async context, e.g., an Express route handler):
/*
async function handleChatRequest(req, res) {
  const userMessage = req.body.message;
  const context = { shopName: "Example Shop", etc: "..." }; // Build context

  const llmReply = await callLLM(userMessage, context);

  if (llmReply) {
    res.json({ reply: llmReply, source: 'llm' });
  } else {
    // Fallback to rule-based logic or default message
    res.json({ reply: "Sorry, I couldn't process that right now.", source: 'fallback' });
  }
}
*/

// Chat endpoint with Shopify integration
app.post('/api/chat', async (req, res, next) => {
  try {
    if (!shopify) {
      throw new Error('Shopify client not initialized');
    }

    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Try to use LLM if configured
    if (process.env.LLM_API_KEY && process.env.LLM_PROVIDER) {
      console.log('Using LLM for response generation');
      
      // Get relevant context for the LLM
      const context = {
        shopName: 'Iris Essentials',
        website: 'https://irisessentials.com',
        policies: {
          shipping: "Standard UK Delivery (3-5 business days): FREE on orders over £50, otherwise £3.99. Express UK Delivery (1-2 business days): £6.99.",
          returns: "30-day return window from delivery date. Items must be unused and in original packaging.",
          rewards: "Earn 1 point for every £1 spent. 500 points = £5 reward."
        }
      };
      
      // If it's a product query, add product information to context
      if (/product|item|merchandise|goods|buy|purchase|order/i.test(message)) {
        try {
          const client = new shopify.clients.Rest({
            session: {
              accessToken: process.env.SHOPIFY_ACCESS_TOKEN,
              shop: new URL(process.env.SHOPIFY_SHOP_URL).hostname
            }
          });
          
          const response = await client.get({
            path: 'products',
            query: { limit: 10 }
          });
          
          context.products = response.body.products.map(p => ({
            title: p.title,
            price: p.variants[0]?.price || 'Price not available',
            description: p.body_html?.replace(/<[^>]*>/g, '') || 'No description'
          }));
        } catch (error) {
          console.error('Error fetching products for LLM context:', error);
        }
      }
      
      const llmResponse = await callLLM(message, context);
      
      if (llmResponse) {
        return res.json({ reply: llmResponse });
      }
      // If LLM fails, fall back to rule-based responses
      console.log('LLM failed, falling back to rule-based responses');
    }

    // Check for different types of queries
    const isProductQuery = /product|item|merchandise|goods|buy|purchase|order/i.test(message);
    const isSpecificProductQuery = /7-in-1 LED|LED Light Therapy|Light Therapy Device|Youthful Skin/i.test(message);
    const isGoldEyeMaskQuery = /24K Gold Eye Mask|Gold Eye Mask|Eye Mask|Puffiness|Wrinkle Relief/i.test(message);
    const isRewardsQuery = /reward|loyalty|points|program|earn|redeem/i.test(message);
    const isFaqQuery = /faq|question|frequently asked/i.test(message);
    const isRefundQuery = /refund|return|exchange|money back/i.test(message);
    const isShippingQuery = /shipping|delivery|postage|send|track/i.test(message);
    const isPrivacyQuery = /privacy|data|information|collect|cookie/i.test(message);
    const isTermsQuery = /terms|conditions|service|legal/i.test(message);
    const isContactQuery = /contact|support|help|email|phone|call/i.test(message);
    const isSocialMediaQuery = /social|media|facebook|instagram|twitter|tiktok|follow/i.test(message);
    
    if (isFaqQuery) {
      return res.json({
        reply: "You can find answers to frequently asked questions on our FAQ page: https://irisessentials.com/pages/faqs\n\nSome common questions include:\n• How do I track my order?\n• What payment methods do you accept?\n• Are your products cruelty-free?\n• How can I join the rewards program?\n\nIs there something specific you'd like to know?"
      });
    } else if (isRefundQuery) {
      return res.json({
        reply: "Our refund policy includes:\n\n• 30-day return window from delivery date\n• Items must be unused, unworn, and in original packaging\n• Original receipt or proof of purchase required\n• Refunds processed to original payment method within 5-7 business days\n• Return shipping costs are the customer's responsibility\n• Sale items can only be exchanged for store credit\n\nFor more details: https://irisessentials.com/policies/refund-policy"
      });
    } else if (isShippingQuery) {
      return res.json({
        reply: "Our shipping policy details:\n\n• Standard UK Delivery (3-5 business days): FREE on orders over £50, otherwise £3.99\n• Express UK Delivery (1-2 business days): £6.99\n• International shipping available to EU, US, Canada, and Australia\n• International delivery takes 7-14 business days\n• All orders receive tracking information via email\n• We're not responsible for customs fees on international orders\n• Free returns within the UK within 30 days\n\nMore info: https://irisessentials.com/policies/shipping-policy"
      });
    } else if (isPrivacyQuery) {
      return res.json({
        reply: "Our privacy policy key points:\n\n• We collect personal information (name, email, address) only for processing orders\n• Payment information is securely processed through Shopify Payments\n• We use cookies to enhance browsing experience and analyze site traffic\n• We never sell your personal information to third parties\n• Marketing emails include an unsubscribe option\n• You can request access to your personal data or deletion at any time\n• We use industry-standard security measures to protect your data\n\nFull policy: https://irisessentials.com/policies/privacy-policy"
      });
    } else if (isTermsQuery) {
      return res.json({
        reply: "Our Terms of Service highlights:\n\n• You must be at least 18 years old to make a purchase\n• Creating an account requires accurate and complete information\n• Product images are representative, slight variations may occur\n• We reserve the right to refuse service to anyone\n• Prices are subject to change without notice\n• We are not liable for delivery delays due to shipping carriers\n• Intellectual property (images, logos, content) belongs to Iris Essentials\n• User-generated content may be used for marketing with permission\n\nComplete terms: https://irisessentials.com/policies/terms-of-service"
      });
    } else if (isContactQuery) {
      return res.json({
        reply: "You can contact our customer support team through:\n• Email: contact@irisessentials.com\n• Phone: +447463084372 (Mon-Fri, 9am-5pm GMT)\n• Contact form: https://irisessentials.com/pages/contact\n\nWe aim to respond to all inquiries within 24 hours."
      });
    } else if (isSocialMediaQuery) {
      return res.json({
        reply: "Follow us on social media to stay updated with our latest products and promotions:\n• Instagram: @iris_essentials\n• Facebook: @IrisEssentialsOfficial\n• TikTok: @iris_essentials\n• Pinterest: @irisessentials\n\nWe love seeing our products in action! Tag us using #IrisEssentials"
      });
    } else if (isRewardsQuery) {
      return res.json({
        reply: "Our Iris Rewards program lets you earn points with every purchase! Here's how it works:\n\n• Earn 1 point for every £1 spent\n• 500 points = £5 reward\n• 1000 points = £10 reward\n• 2000 points = £20 reward\n\nYou can also earn points by:\n• Creating an account: 100 points\n• Following us on Instagram: 50 points\n• Celebrating your birthday: 100 points\n• Referring a friend: 200 points\n\nLearn more at: https://irisessentials.com/pages/rewards-program"
      });
    } else if (isSpecificProductQuery) {
      // Handle specific product query for LED Light Therapy Device
      return res.json({
        reply: "**7-in-1 LED Light Therapy Device for Youthful Skin Care**\n\nPrice: £89.99\n\nThis advanced skincare device uses 7 different LED light wavelengths to target various skin concerns:\n\n• Red light: Stimulates collagen production\n• Blue light: Treats acne and prevents breakouts\n• Green light: Reduces pigmentation and evens skin tone\n• Yellow light: Reduces redness and inflammation\n• Purple light: Detoxifies skin and improves lymphatic flow\n• Cyan light: Soothes sensitive skin\n• White light: Penetrates deeply for overall rejuvenation\n\nThe device is rechargeable, FDA-approved, and clinically tested. Use for just 10 minutes daily to see visible results within 4-6 weeks.\n\nWould you like to know more about this product or other skincare devices we offer?"
      });
    } else if (isProductQuery) {
      // Check if a specific collection is mentioned
      const beautyCollectionQuery = /beauty|beauty essentials|skincare|makeup|cosmetic/i.test(message);
      const kitchenCollectionQuery = /kitchen|cooking|culinary|baking/i.test(message);
      
      // Fetch products from Shopify
      const client = new shopify.clients.Rest({
        session: {
          accessToken: process.env.SHOPIFY_ACCESS_TOKEN,
          shop: new URL(process.env.SHOPIFY_SHOP_URL).hostname
        }
      });
      
      // First, try to get collections to find the right collection ID
      let collectionId = null;
      let collectionName = "";
      
      if (beautyCollectionQuery || kitchenCollectionQuery) {
        const collectionsResponse = await client.get({
          path: 'custom_collections'
        });
        
        const collections = collectionsResponse.body.custom_collections || [];
        
        if (beautyCollectionQuery) {
          const beautyCollection = collections.find(c => 
            /beauty|beauty essentials/i.test(c.title)
          );
          if (beautyCollection) {
            collectionId = beautyCollection.id;
            collectionName = beautyCollection.title;
          }
        } else if (kitchenCollectionQuery) {
          const kitchenCollection = collections.find(c => 
            /kitchen|kitchen essentials/i.test(c.title)
          );
          if (kitchenCollection) {
            collectionId = kitchenCollection.id;
            collectionName = kitchenCollection.title;
          }
        }
      }
      
      // Query parameters for products
      const queryParams = { limit: 5 };
      
      // If we have a collection ID, use it to filter products
      let products = [];
      if (collectionId) {
        // Get products from the specific collection
        const collectionProductsResponse = await client.get({
          path: `collections/${collectionId}/products`,
          query: queryParams
        });
        products = collectionProductsResponse.body.products || [];
      } else {
        // Get general products if no specific collection
        const response = await client.get({
          path: 'products',
          query: queryParams
        });
        products = response.body.products || [];
      }
      
      if (products.length === 0) {
        return res.json({ 
          reply: collectionId 
            ? `I couldn't find any products in the ${collectionName} collection. Please check back later.`
            : "I couldn't find any products in the store. Please check back later." 
        });
      }
      
      // Format product information with improved price handling
      const productList = products.map(product => {
        // Improved price extraction logic
        let price = 'Price not available';
        
        // Check if product has variants
        if (product.variants && product.variants.length > 0) {
          // Get the first variant with a valid price
          const variantWithPrice = product.variants.find(v => 
            v.price && parseFloat(v.price) > 0
          );
          
          if (variantWithPrice) {
            price = `£${parseFloat(variantWithPrice.price).toFixed(2)}`;
          }
        }
        
        // If no variant price found, try the product price directly
        if (price === 'Price not available' && product.price && parseFloat(product.price) > 0) {
          price = `£${parseFloat(product.price).toFixed(2)}`;
        }
        
        return `• ${product.title}: ${price}`;
      }).join('\n');
      
      return res.json({ 
        reply: collectionId 
          ? `Here are some products from our ${collectionName} collection:\n\n${productList}\n\nWould you like more information about any of these products?`
          : `Here are some products from our store:\n\n${productList}\n\nWould you like more information about any of these products?` 
      });
    }
    
    // Default response for other queries
    return res.json({ 
      reply: "I'm here to help you with information about our products, rewards program, shipping, returns, and more. What would you like to know? I can provide details about our policies, not just links." 
    });
    
  } catch (error) {
    console.error('Error processing chat message:', error);
    if (error.response) {
      // Shopify API error
      return res.status(error.response.status || 500).json({
        error: {
          message: error.response.body?.errors || error.message,
          status: error.response.status,
          type: 'ShopifyAPIError'
        }
      });
    }
    next(error);
  }
});

// Products endpoint with enhanced error handling
app.get('/api/products', async (req, res, next) => {
  try {
    if (!shopify) {
      throw new Error('Shopify client not initialized');
    }

    const client = new shopify.clients.Rest({
      session: {
        accessToken: process.env.SHOPIFY_ACCESS_TOKEN,
        shop: process.env.SHOPIFY_SHOP_URL
      }
    });
    
    const products = await client.get({
      path: 'products'
    });
    
    res.json(products);
  } catch (error) {
    if (error.response) {
      // Shopify API error
      return res.status(error.response.status || 500).json({
        error: {
          message: error.response.body?.errors || error.message,
          status: error.response.status,
          type: 'ShopifyAPIError'
        }
      });
    }
    next(error);
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: {
      message: 'Route not found',
      status: 404
    }
  });
});

// Global error handler
app.use(errorHandler);

// Start server with error handling
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
}).on('error', (error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (error) => {
  console.error('Unhandled Rejection:', error);
  process.exit(1);
});

// Settings endpoint to update LLM configuration
app.post('/api/settings', async (req, res, next) => {
  try {
    const { llmProvider, llmApiKey, llmModel } = req.body;
    
    // Update environment variables (note: this doesn't persist after restart)
    if (llmProvider) process.env.LLM_PROVIDER = llmProvider;
    if (llmApiKey) process.env.LLM_API_KEY = llmApiKey;
    if (llmModel) process.env.LLM_MODEL = llmModel;
    
    // For persistence, you would need to update the .env file or use a database
    
    res.json({ 
      status: 'success',
      message: 'Settings updated successfully',
      settings: {
        llmProvider: process.env.LLM_PROVIDER || null,
        llmApiKey: process.env.LLM_API_KEY ? '********' : null,
        llmModel: process.env.LLM_MODEL || null
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get current settings
app.get('/api/settings', (req, res, next) => {
  try {
    res.json({
      llmProvider: process.env.LLM_PROVIDER || null,
      llmApiKey: process.env.LLM_API_KEY ? '********' : null,
      llmModel: process.env.LLM_MODEL || null
    });
  } catch (error) {
    next(error);
  }
});

# RefCheckWebApp

  

**Live App:** https://janbndrf.github.io/RefCheckWebApp

  

**Disclaimer:** This is a low-effort vibecoded webapp that was supposed to solve a personal problem. It eventually turned out to be useful enough that it might help others too.

  

## 

  

RefCheckWebApp extracts bibliographic citations from pasted bibliography text and validates them. It uses LLMs to parse citations from any citation format (just copy and paste), then validates them against academic databases (CrossRef and OpenAlex). 

This is especially usefull to identify AI-generated non valid citations, which are unfortunately becoming increasingly common in students submissions. AI invents fake references and this tool uses AI to make it somewhat easier to at least get an overview about the submitted references. The circle of life of wasting computational power...



## Demo

![RefCheckWebApp Demo](docs/Kooha-2025-12-04-17-47-54.gif)


## Quick Setup for Analysis

  

### Prerequisites

  

You'll need an AI model to extract information from the references.
- This can be OpenAI, Google AI, or even local models (anything with an OpenAI-compatible API)

-  The easiest would be using your Google account to get some free requests to their AI Models. Most people already have a Google account, which means you can get a Google AI API at https://aistudio.google.com/api-keys

Don't be intimidated if you're non-technical. Getting an API key is straightforward, and the app itself is extremely easy to use. The Webapps settings page has explainations about each point,, to help you setup everything. If you know what youre doing its less than a minute. First time might take about 15 minutes.

    

## **Using the app**

1. : Just visit https://janbndrf.github.io/RefCheckWebApp

  

2.  **Configure Model and other settings**

- Click the settings icon in the top right

- Setup the LLM model. So add your Google API Key and select a model from the dropdown


3.  **Process a bibliography**

- Copy your bibliography text from anywhere (any citation format works)

- Paste it into the left panel

- Click "Process Bibliography"

- Watch as it processes each window and extracts citations

- Review results in the right panel with validation status

 
  

  
## License
MIT

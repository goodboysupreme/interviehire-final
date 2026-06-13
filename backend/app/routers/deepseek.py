from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import urllib.request
import json
from app.config import settings

router = APIRouter()

class DeepSeekRequest(BaseModel):
    messages: List[Dict[str, Any]]
    jsonMode: Optional[bool] = False

@router.post("")
def proxy_deepseek(data: DeepSeekRequest):
    import os
    
    deepseek_key = settings.DEEPSEEK_API_KEY
    groq_key = settings.GROQ_API_KEY if hasattr(settings, "GROQ_API_KEY") else os.getenv("GROQ_API_KEY")
    grok_key = (settings.GROK_API_KEY if hasattr(settings, "GROK_API_KEY") else None) or os.getenv("GROK_API_KEY") or os.getenv("XAI_API_KEY")
    gemini_key = settings.GEMINI_API_KEY if hasattr(settings, "GEMINI_API_KEY") else os.getenv("GEMINI_API_KEY")
    
    # 1. Attempt DeepSeek
    if deepseek_key:
        try:
            payload = {
                "model": "deepseek-chat",
                "messages": data.messages,
                "temperature": 0.7,
                "max_tokens": 3000,
            }
            if data.jsonMode:
                payload["response_format"] = {"type": "json_object"}
            
            url = "https://api.deepseek.com/v1/chat/completions"
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {deepseek_key}"
                },
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=40) as response:
                return json.loads(response.read().decode("utf-8"))
        except Exception as err:
            import traceback
            try:
                with open("c:\\Users\\KRISHNA GUPTA\\Desktop\\interviehire\\deepseek_error.log", "a", encoding="utf-8") as f:
                    f.write(f"--- DeepSeek proxy failure: {err} ---\n")
                    traceback.print_exc(file=f)
            except:
                pass
            print(f"DeepSeek proxy failure: {err}. Falling back to next LLM...")

    # 2. Attempt Groq
    if groq_key:
        try:
            payload = {
                "model": "llama-3.1-8b-instant",
                "messages": data.messages,
                "temperature": 0.7,
                "max_tokens": 3000,
            }
            if data.jsonMode:
                payload["response_format"] = {"type": "json_object"}
            
            url = "https://api.groq.com/openai/v1/chat/completions"
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {groq_key}",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                },
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except Exception as err:
            print(f"Groq proxy failure: {err}. Falling back to next LLM...")

    # 3. Attempt Grok (xAI)
    if grok_key:
        try:
            payload = {
                "model": "grok-beta",
                "messages": data.messages,
                "temperature": 0.7,
                "max_tokens": 3000,
            }
            if data.jsonMode:
                payload["response_format"] = {"type": "json_object"}
            
            url = "https://api.xai.com/v1/chat/completions"
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {grok_key}"
                },
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except Exception as err:
            print(f"Grok proxy failure: {err}. Falling back to next LLM...")

    # 4. Attempt Gemini
    if gemini_key:
        try:
            # Prepare prompts from OpenAI format
            prompt_parts = []
            for msg in data.messages:
                role = msg.get("role", "user")
                content = msg.get("content", "")
                prompt_parts.append(f"{role.upper()}: {content}")
            prompt_text = "\n\n".join(prompt_parts)
            
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={gemini_key}"
            payload = {
                "contents": [
                    {
                        "parts": [
                            {"text": prompt_text}
                        ]
                    }
                ]
            }
            
            # Conditionally add jsonMode response structure
            if data.jsonMode:
                payload["generationConfig"] = {"responseMimeType": "application/json"}
                
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                },
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=30) as response:
                res_data = json.loads(response.read().decode("utf-8"))
                text_content = res_data["candidates"][0]["content"]["parts"][0]["text"].strip()
                # Wrap in OpenAI compatible choices format
                return {
                    "choices": [
                        {
                            "message": {
                                "role": "assistant",
                                "content": text_content
                            }
                        }
                    ]
                }
        except Exception as err:
            print(f"Gemini proxy failure: {err}")

    # If all fail or no keys exist
    try:
        with open("c:\\Users\\KRISHNA GUPTA\\Desktop\\interviehire\\deepseek_error.log", "a", encoding="utf-8") as f:
            f.write(f"All attempts failed. Keys present: DeepSeek={bool(deepseek_key)}, Groq={bool(groq_key)}, Grok={bool(grok_key)}, Gemini={bool(gemini_key)}\n")
    except:
        pass
    raise HTTPException(
        status_code=500,
        detail="No LLM API key configured (DeepSeek, Groq, Grok, Gemini), or all attempts failed."
    )

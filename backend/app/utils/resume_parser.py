import os
import re
import json
import urllib.request
import shutil
from typing import Optional, Dict, Any

def extract_text_from_file(file_path: str) -> str:
    """Extracts raw text from PDF, DOCX, or TXT file using standard libraries with fallback."""
    if not os.path.exists(file_path):
        return ""
    
    file_text = ""
    try:
        if file_path.endswith(".pdf"):
            # Try pypdf first
            try:
                import pypdf
                reader = pypdf.PdfReader(file_path)
                pages_text = []
                for page in reader.pages:
                    text = page.extract_text()
                    if text:
                        pages_text.append(text)
                file_text = "\n".join(pages_text).strip()
            except Exception as e:
                print(f"pypdf extraction failed, falling back to regex: {e}")
                
            # Fallback to regex if pypdf failed or returned empty text
            if not file_text:
                with open(file_path, "rb") as f:
                    content = f.read()
                    strings = re.findall(rb"[a-zA-Z0-9\s\.,;:!\?\-\'\"]{4,}", content)
                    file_text = " ".join([s.decode("ascii", errors="ignore") for s in strings[:2000]])
                    
        elif file_path.endswith(".txt"):
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                file_text = f.read()
                
        elif file_path.endswith(".docx"):
            # Try python-docx first
            try:
                import docx
                doc = docx.Document(file_path)
                paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
                file_text = "\n".join(paragraphs).strip()
            except Exception as e:
                print(f"python-docx extraction failed, falling back to zip: {e}")
                
            # Fallback to zip if docx failed or returned empty text
            if not file_text:
                import zipfile
                with zipfile.ZipFile(file_path) as z:
                    xml_content = z.read("word/document.xml")
                    clean = re.sub(b"<[^>]*>", b"", xml_content)
                    file_text = clean.decode("utf-8", errors="ignore")
    except Exception as e:
        print(f"Error extracting text from {file_path}: {e}")
        
    # Standardize spaces and limit length to ~12000 chars
    file_text = " ".join(file_text.split())
    return file_text[:12000]

def clean_filename_to_name(filename: str) -> str:
    """Clean candidate name from filename (e.g. 'aditya_rana_resume' -> 'Aditya Rana')"""
    filename_without_ext = os.path.splitext(filename)[0]
    temp_name = filename_without_ext.lower()
    for word_to_remove in ["resume", "cv", "profile", "bio", "final", "candidate"]:
        temp_name = temp_name.replace(word_to_remove, "")
    temp_name = temp_name.replace("_", " ").replace("-", " ").strip()
    cleaned_name = " ".join([word.capitalize() for word in temp_name.split()])
    return cleaned_name if cleaned_name else "Candidate"

def parse_resume_local_heuristics(file_text: str, filename: str) -> Dict[str, Any]:
    """Fallback local parser using regex and filename clean-up."""
    # 1. Find email
    email = None
    email_match = re.search(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+", file_text)
    if email_match:
        email = email_match.group(0).strip()
        
    # 2. Find phone number
    phone = None
    phone_match = re.search(r"(\+?\d[\d\-\s\(\)]{7,}\d)", file_text)
    if phone_match:
        phone = phone_match.group(0).strip()
        
    # 3. Guess name from file text or email or clean filename
    name = None
    if file_text:
        # Check first 15 words for capitalized candidate names
        words = [w.strip() for w in file_text.split(" ") if w.strip()]
        capitalized = []
        forbidden_words = {
            "resume", "cv", "curriculum", "vitae", "pdf", "docx", "graduation", "university",
            "experience", "education", "school", "college", "summary", "skills", "projects",
            "work", "profile", "january", "february", "march", "april", "may", "june",
            "july", "august", "september", "october", "november", "december",
            "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
            "contact", "phone", "email", "address", "links", "about", "me", "hobbies",
            "certifications", "languages", "gpa", "cgpa", "phone:", "email:",
            # job-title / role words so the name doesn't absorb the headline
            "developer", "engineer", "backend", "frontend", "fullstack", "full-stack",
            "senior", "junior", "lead", "manager", "designer", "analyst", "consultant",
            "architect", "scientist", "intern", "specialist", "administrator", "devops",
            "software", "web", "data", "cloud", "mobile", "product", "project", "qa",
            "tester", "programmer", "technical", "associate", "executive", "officer"
        }
        for word in words[:15]:
            clean_word = re.sub(r"[^\w]", "", word)
            if clean_word and clean_word[0].isupper() and clean_word.lower() not in forbidden_words:
                if not re.search(r"\d", clean_word):
                    capitalized.append(clean_word)
        if len(capitalized) >= 2:
            name = " ".join(capitalized[:3])
            
    if not name and email:
        username = email.split("@")[0]
        clean_user = re.sub(r"\d+", "", username)
        clean_user = clean_user.replace(".", " ").replace("_", " ").replace("-", " ").strip()
        if clean_user:
            name = " ".join([w.capitalize() for w in clean_user.split()])
            
    if not name:
        name = clean_filename_to_name(filename)
        
    if not email:
        email = f"{name.lower().replace(' ', '.')}@candidate.io"
        
    if not phone:
        phone = "+1 555-0199"
        
    return {
        "name": name,
        "email": email,
        "phone": phone
    }

def parse_resume_with_deepseek(file_path: str, filename: str, api_key: Optional[str] = None) -> Dict[str, Any]:
    """Parses a candidate's resume using DeepSeek AI, falling back to local heuristics."""
    file_text = extract_text_from_file(file_path)
    
    if not file_text:
        return parse_resume_local_heuristics("", filename)
        
    if not api_key:
        return parse_resume_local_heuristics(file_text, filename)
        
    # Call DeepSeek API
    try:
        url = "https://api.deepseek.com/v1/chat/completions"
        payload = {
            "model": "deepseek-chat",
            "messages": [
                {
                    "role": "system",
                    "content": "You are a precise resume parser. Extract the candidate's full name, email, and phone number from the resume text. Return ONLY a valid JSON object matching the schema: {\"name\": \"string or null\", \"email\": \"string or null\", \"phone\": \"string or null\"}. Do not write markdown tags or extra explanations."
                },
                {
                    "role": "user",
                    "content": file_text[:3500]
                }
            ],
            "response_format": {"type": "json_object"}
        }
        
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}"
            },
            method="POST"
        )
        
        with urllib.request.urlopen(req, timeout=15) as response:
            res_data = json.loads(response.read().decode("utf-8"))
            content = res_data["choices"][0]["message"]["content"].strip()
            ai_data = json.loads(content)
            
            # Extract and validate fields
            name = ai_data.get("name")
            email = ai_data.get("email")
            phone = ai_data.get("phone")
            
            # Handle null fallbacks
            if not name:
                name = clean_filename_to_name(filename)
            if not email:
                email = f"{name.lower().replace(' ', '.')}@candidate.io"
            if not phone:
                phone = "+1 555-0199"
                
            return {
                "name": name,
                "email": email,
                "phone": phone
            }
    except Exception as e:
        print(f"DeepSeek resume parsing failed: {e}. Falling back to local heuristics.")
        return parse_resume_local_heuristics(file_text, filename)

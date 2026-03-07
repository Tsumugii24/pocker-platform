from dotenv import load_dotenv
from openai import OpenAI
import os
from pathlib import Path

load_dotenv()

# 模型调用测试
client = OpenAI(
    api_key=os.getenv("OPENAI_API_KEY"),
    base_url=os.getenv("OPENAI_BASE_URL")
)


response = client.chat.completions.create(
    model=os.getenv("OPENAI_MODEL"),
    messages=[
        {
            'role': 'system',
            'content': 'You are a helpful assistant.'
        },
        {
            'role': 'user',
            'content': 'hello'
        }
    ]
)

if __name__ == "__main__":
    print(response.choices[0].message.content)
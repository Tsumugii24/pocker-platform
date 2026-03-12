import requests

def test_cached_boards():
    url = "http://127.0.0.1:5000/api/cached-boards"
    try:
        response = requests.get(url)
        if response.status_code == 200:
            print("Successfully fetched cached boards:")
            print(response.json())
        else:
            print(f"Failed to fetch cached boards. Status code: {response.status_code}")
            print(response.text)
    except Exception as e:
        print(f"Error connecting to backend: {e}")

if __name__ == "__main__":
    test_cached_boards()

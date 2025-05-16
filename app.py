from flask import Flask, request, jsonify, send_from_directory, Response, render_template, redirect, url_for
from database import Database
from ansible_manager import AnsibleManager
import json
import os
from functools import wraps
import secrets
from flask_sock import Sock
import paramiko
import threading
import stat
from werkzeug.utils import secure_filename
import time
import hmac
import hashlib
import jwt
import datetime
import logging
from crypto_utils import CryptoUtils, set_crypto_keys, derive_key_from_credentials

# 新增获取客户端真实IP的函数
def get_client_ip():
# Try to get it from common proxy headers
    if request.headers.get('X-Forwarded-For'):
       # Get the first IP in the list (usually the original client)
        return request.headers.get('X-Forwarded-For').split(',')[0].strip()
    elif request.headers.get('X-Real-IP'):
        return request.headers.get('X-Real-IP')
    # If there is no proxy header, use direct IPproxy header, use direct IP
    return request.remote_addr

app = Flask(__name__, static_folder='public', static_url_path='')
app.secret_key = secrets.token_hex(32)
# Set the token expiration time to 5 hours
JWT_EXPIRATION = 5 * 60 * 60  # 5 hours, in seconds
JWT_SECRET = app.secret_key
db = Database()
ansible = AnsibleManager(db)
crypto = CryptoUtils()

# Account password variable
ADMIN_USERNAME = os.getenv('ADMIN_USERNAME')
ADMIN_PASSWORD = os.getenv('ADMIN_PASSWORD')

# Check the necessary environment variables
if not ADMIN_USERNAME or not ADMIN_PASSWORD:
    app.logger.warning("Administrator credential environment variable not set(ADMIN_USERNAME/ADMIN_PASSWORD)，Please set these environment variables to ensure system security")

#Configuring WebSocket
sock = Sock(app)
sock.init_app(app)

UPLOAD_FOLDER = '/tmp/ansible_uploads'

# Make sure the upload directory exists
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Simplify the allowed_file function
def allowed_file(filename):
    """Check whether files are allowed to upload. The current policy is to allow all files."""
    return True

def handle_error(f):
    """Error handling decorator"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        try:
            return f(*args, **kwargs)
        except Exception as e:
            app.logger.error(f"Error in {f.__name__}: {str(e)}")
            return jsonify({'error': str(e)}), 500
    return decorated_function

def auth_required(f):
    """JWT certification requires decorator"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # Get the Authorization header
        auth_header = request.headers.get('Authorization')
        token = None
        
        # Extract token from header
        if auth_header and auth_header.startswith('Bearer '):
            token = auth_header.split(' ')[1]
        
        #If the token is not in the header, try to get it from cookies
        if not token:
            token = request.cookies.get('token')
            
        # If the token is not in the cookies, try to get it from the query parameters (for compatibility with certain scenarios)
        if not token:
            token = request.args.get('token')
            
        if not token:
            return jsonify({'error': 'Unauthorized'}), 401
            
        user = decode_token(token)
        if not user:
            return jsonify({'error': 'Invalid or expired token'}), 401
        
        # On each API call, if no encryption key is set, it is derived from user credentials
# Here import global variables from crypto_utils
        from crypto_utils import CRYPTO_KEY, CRYPTO_SALT
        
        #Check if the key is valid or needs to be re-derived
        if (CRYPTO_KEY is None or 
            isinstance(CRYPTO_KEY, bytes) and (len(CRYPTO_KEY) != 32 or CRYPTO_KEY == os.urandom(32))) and ADMIN_USERNAME and ADMIN_PASSWORD:
            # Try to derive a key only when an environment variable is set
            app.logger.info("The encryption key was detected in the API call or was invalid, and attempted to derive from the user credentials")
            try:
                key, salt = derive_key_from_credentials(ADMIN_USERNAME, ADMIN_PASSWORD)
                set_crypto_keys(key, salt)
                app.logger.info("Key derivation is successful, length is: %d bytes", len(key))
            except Exception as e:
                app.logger.error(f"Key derivation failed: {str(e)}")
                return jsonify({'error': 'System encryption configuration is incorrect, please contact the administrator'}), 500
            
        # Add user information to the request so that the view function can be used
        request.user = user
        return f(*args, **kwargs)
    return decorated_function

@app.before_request
def before_request():
    app.logger.info(f"Processing a request: {request.path}")
    
    if request.method == 'OPTIONS':
        return None
        
    if request.path.startswith('/ws/'):
        return None
        
    if request.path.startswith('/terminal'):
        return None
    
    if request.path == '/login':
        return None
        
    if request.path.startswith('/api/') and request.path != '/api/login':
        auth_header = request.headers.get('Authorization')
        token = None
        
        if auth_header and auth_header.startswith('Bearer '):
            token = auth_header.split(' ')[1]
        
        if not token:
            token = request.cookies.get('token')
            
        if not token:
            token = request.args.get('token')
            
        if not token:
            return jsonify({'error': 'Unauthorized'}), 401
            
        user = decode_token(token)
        if not user:
            return jsonify({'error': 'Invalid or expired token'}), 401
            
        request.user = user
    else:
        pass

@app.after_request
def after_request(response):
    
    # Log API requests
    if request.path.startswith("/api/"):
        status = 'success' if response.status_code < 400 else 'failed'
        db.add_access_log(
            get_client_ip(),
            request.path, 
            status,
            response.status_code
        )
    return response


@app.route('/api/login', methods=['POST'])
def login():
    """User login"""
    data = request.json
    username = data.get('username')
    password = data.get('password')

    # Make sure the environment variable is set
    if not ADMIN_USERNAME or not ADMIN_PASSWORD:
        app.logger.error("The system does not configure administrator credentials")
        return jsonify({'success': False, 'message': 'System configuration error'}), 500

    if username == ADMIN_USERNAME and password == ADMIN_PASSWORD:
        # Deriving encryption keys from user credentials
        try:
            key, salt = derive_key_from_credentials(username, password)
            
            # Setting up a global encryption key
            set_crypto_keys(key, salt)
            app.logger.info(f"The encryption key has been successfully derived from the user credentials, with length of: {len(key)} byte")
            
            # Generate JWT token
            token = generate_token('admin')
            
            # Create a response containing a token
            response_data = {'success': True, 'message': '登录成功', 'token': token}
            response = jsonify(response_data)
            
            # The token is also included in the cookie, which is convenient for front-end acquisition
# secure=True means only sent in HTTPS connection
# httponly=True means that JavaScript cannot access cookies, increasing security
# samesite='Lax' prevents CSRF attacks
            response.set_cookie(
                'token', 
                token, 
                max_age=JWT_EXPIRATION, 
                # secure=True, # Production environment recommended to turn on
                httponly=True,
                samesite='Lax'
            )
            
            return response
        except Exception as e:
            app.logger.error(f"Key derivation failed: {str(e)}")
            return jsonify({'success': False, 'message': 'Login failed, system encryption configuration error'}), 500
    else:
        app.logger.warning(f"Login failed, username or password is incorrect: {username}")
        return jsonify({'success': False, 'message': 'Incorrect username or password'}), 401


@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_react_app(path):
    """Process front-end routing - All routes are handed over to React unless they are static files"""
    app.logger.info(f"serve_react_app Processing path: '{path}'")
    
    # Explicitly handle terminal paths (together with slashes and no slashes)
    if path.startswith('terminal'):
        app.logger.info(f"Determine the terminal path: {path}")
        return send_from_directory(app.static_folder, 'index.html')
    
    # If it is an API request or WebSocket routing, it will not be processed (there is already a dedicated processor)
    if path.startswith('api/') or path.startswith('ws/'):
        app.logger.info(f"API or WebSocket path, return 404: {path}")
        return jsonify({'error': 'Not found'}), 404
    
    # Check whether the requested path corresponds to an actual existing file in the public directory
    static_file_path = os.path.join(app.static_folder, path)
    app.logger.info(f"Try to find a static file: {static_file_path}")
    if path != "" and os.path.exists(static_file_path) and not os.path.isdir(static_file_path):
        app.logger.info(f"Find the static file and return: {static_file_path}")
        # If it is an actual file (such as CSS, JS, pictures), then the file is provided directly
        return send_from_directory(app.static_folder, path)
    else:
        app.logger.info(f"No static file found, return index.html for front-end routing: {path}")
        # Otherwise, provide public/index.html to let React Router handle routing
        return send_from_directory(app.static_folder, 'index.html')

@app.route('/api/hosts', methods=['GET'])
@handle_error
@auth_required
def get_hosts():
    """Get a list of all hosts"""
    hosts = db.get_hosts()
    for host in hosts:
        # No clear text password is returned to the front end, but the encryption is reserved for identification
        host['is_password_encrypted'] = crypto.is_encrypted(host['encrypted_password'])
        host['password'] = '********'
        # Delete fields that do not need to be returned
        if 'encrypted_password' in host:
            del host['encrypted_password']
    return jsonify(hosts)

@app.route('/api/hosts/<int:host_id>', methods=['GET'])
@handle_error
@auth_required
def get_host(host_id):
    """Get single host information"""
    host = db.get_host(host_id)
    if host:
        # No clear text password is returned to the front end, but the encryption is reserved for identification
        host['is_password_encrypted'] = crypto.is_encrypted(host['encrypted_password'])
        host['password'] = '********'
        # Delete fields that do not need to be returned
        if 'encrypted_password' in host:
            del host['encrypted_password']
        return jsonify(host)
    return jsonify({'error': 'Host not found'}), 404

@app.route('/api/hosts', methods=['POST'])
@handle_error
@auth_required
def add_host():
    """Add a single host"""
    host_data = request.json
    required_fields = ['comment', 'address', 'username', 'port', 'password']
    
    if not all(field in host_data for field in required_fields):
        return jsonify({'error': 'Missing required fields'}), 400
    
    host_id = db.add_host(host_data)
    return jsonify({
        'message': 'Host added successfully',
        'host_id': host_id
    }), 201

@app.route('/api/hosts/batch', methods=['POST'])
@handle_error
@auth_required
def add_hosts_batch():
    """Add host in batches"""
    hosts_data = request.json
    if not isinstance(hosts_data, list):
        return jsonify({'error': 'Invalid data format'}), 400

    required_fields = ['comment', 'address', 'username', 'port', 'password']
    for host in hosts_data:
        if not all(field in host for field in required_fields):
            return jsonify({'error': f'Missing required fields in host data: {host}'}), 400

    count = db.add_hosts_batch(hosts_data)
    return jsonify({
        'message': f'Successfully added {count} hosts',
        'count': count
    })

@app.route('/api/hosts/<int:host_id>', methods=['PUT'])
@handle_error
@auth_required
def update_host(host_id):
    """Update host information"""
    host_data = request.json
    required_fields = ['comment', 'address', 'username', 'port']
    
    if not all(field in host_data for field in required_fields):
        return jsonify({'error': 'Missing required fields'}), 400
    
    # Check if the host exists
    if not db.get_host(host_id):
        return jsonify({'error': 'Host not found'}), 404
        
    db.update_host(host_id, host_data)
    return jsonify({'message': 'Host updated successfully'})

@app.route('/api/hosts/<int:host_id>', methods=['DELETE'])
@handle_error
@auth_required
def delete_host(host_id):
    """Delete the host"""
    # Check if the host exists
    if not db.get_host(host_id):
        return jsonify({'error': 'Host not found'}), 404
        
    db.delete_host(host_id)
    return jsonify({'message': 'Host deleted successfully'})

@app.route('/api/execute', methods=['POST'])
@handle_error
@auth_required
def execute_command():
    """Execute the command"""
    data = request.json
    command = data.get('command')
    host_ids = data.get('hosts')

    if not command:
        return jsonify({'error': 'Command is required'}), 400

    # Determine the target host
    if host_ids == 'all':
        target_hosts = db.get_hosts()
    else:
        if not isinstance(host_ids, list):
            return jsonify({'error': 'Invalid hosts format'}), 400
        target_hosts = []
        for host_id in host_ids:
            host = db.get_host(host_id)
            if host:
                target_hosts.append(host)
            else:
                return jsonify({'error': f'Host not found: {host_id}'}), 404

    if not target_hosts:
        return jsonify({'error': 'No valid target hosts'}), 400

    # Execute the command and get the result
    results = ansible.execute_command(command, target_hosts)
    return jsonify(results)

@app.route('/api/logs', methods=['GET'])
@handle_error
@auth_required
def get_logs():
    """Get the command execution log"""
    limit = request.args.get('limit', default=100, type=int)
    logs = db.get_command_logs(limit)
    return jsonify(logs)

@app.route('/api/hosts/<int:host_id>/facts', methods=['GET'])
@handle_error
@auth_required
def get_host_facts(host_id):
    """Get host details"""
    facts = ansible.get_host_facts(host_id)
    if facts:
        return jsonify(facts)
    return jsonify({'error': 'Failed to get host facts'}), 404

@app.route('/api/hosts/<int:host_id>/ping', methods=['GET'])
@handle_error
@auth_required
def ping_host(host_id):
    """Check host connectivity"""
    host = db.get_host(host_id)
    if not host:
        return jsonify({'error': 'Host not found'}), 404
    
    # Execute ping modules using Ansible
    results = ansible.execute_ping([host])
    
    # Analysis results
    host_address = host['address']
    if host_address in results['success']:
        return jsonify({'status': 'success', 'message': 'Connection is normal'})
    elif host_address in results['unreachable']:
        return jsonify({'status': 'unreachable', 'message': 'Unable to connect'})
    else:
        return jsonify({'status': 'failed', 'message': 'fail'})

@sock.route('/ws/terminal/<int:host_id>')
def terminal_ws(ws, host_id):
    """Handle terminal WebSocket connections"""
    app.logger.info(f"Handle WebSocket connection requests: host_id={host_id}")
    
    # Check authorization tokens
    token = request.args.get('token')
    if not token:
        app.logger.error(f"Terminal WebSocket Error: Token not provided")
        ws.send(json.dumps({"error": "Authorization required"}))
        return
    
    # Verify that the token is valid
    try:
        # Token format: host_id:timestamp:signature
        parts = token.split(':')
        if len(parts) != 3 or parts[0] != str(host_id):
            raise ValueError("Invalid token format")
            
        # Check if the timestamp is valid (5 minutes)
        token_timestamp = int(parts[1])
        current_time = int(time.time())
        if current_time - token_timestamp > 300:  #5 minutes valid
            raise ValueError("Token expired")
            
        #Verify signature
        message = f"{host_id}:{token_timestamp}"
        expected_signature = hmac.new(
            app.secret_key.encode(),
            message.encode(),
            hashlib.sha256
        ).hexdigest()
        
        if parts[2] != expected_signature:
            raise ValueError("Invalid token signature")
            
    except Exception as e:
        app.logger.error(f"Terminal WebSocket token verification failed")
        ws.send(json.dumps({"error": "Invalid or expired token"}))
        return
    
    host = db.get_host(host_id)
    if not host:
        app.logger.error(f"Terminal WebSocket Error: Host ID does not exist")
        ws.send(json.dumps({"error": "Host not found"}))
        return
    
    app.logger.info(f"Find host information: id={host_id}")
    
    try:
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        
        # Make sure to use the decrypted password
        password = host['password']
        
        app.logger.info(f"Connecting SSH")
        ssh.connect(
            host['address'],
            port=host['port'],
            username=host['username'],
            password=password,
            timeout=10
        )
        
        # Default terminal size
        term_width = 100
        term_height = 30
        
        app.logger.info(f"SSH connection is successful, create a terminal session")
        channel = ssh.invoke_shell(term='xterm-256color', width=term_width, height=term_height)
        
        def send_data():
            while True:
                try:
                    if channel.recv_ready():
                        data = channel.recv(1024).decode('utf-8', errors='ignore')
                        if data:
                            ws.send(data)
                    else:
                        time.sleep(0.1)
                except Exception as e:
                    app.logger.error(f"Data sending error")
                    break
        
        thread = threading.Thread(target=send_data)
        thread.daemon = True
        thread.start()
        
        app.logger.info(f"WebSocket connection has been established, background thread has been started")
        
        # Send initial welcome message
        welcome_msg = f"\r\n\x1b[1;32m*** Connected to the host ***\x1b[0m\r\n"
        ws.send(welcome_msg)
        
        while True:
            try:
                message = ws.receive()
                if message is None:
                    app.logger.info(f"WebSocket connection closed")
                    break
                    
                data = json.loads(message)
                if data['type'] == 'input':
                    channel.send(data['data'])
                elif data['type'] == 'resize':
                    new_size = data['data']
                    channel.resize_pty(
                        width=new_size['cols'],
                        height=new_size['rows']
                    )
            except json.JSONDecodeError as e:
                app.logger.error(f"JSON parsing error")
                continue
            except Exception as e:
                app.logger.error(f"WebSocket Receive Error")
                break
    
    except paramiko.AuthenticationException:
        app.logger.error(f"SSH authentication failed")
        ws.send(f'\r\n\x1b[1;31m*** SSH authentication failed ***\x1b[0m\r\n')
    except paramiko.SSHException as e:
        app.logger.error(f"SSH connection error")
        ws.send(f'\r\n\x1b[1;31m*** SSH connection error ***\x1b[0m\r\n')
    except Exception as e:
        app.logger.error(f"Terminal connection error")
        ws.send(f'\r\n\x1b[1;31m*** Connection error ***\x1b[0m\r\n')
    finally:
        app.logger.info(f"Close the terminal connection")
        if 'channel' in locals():
            channel.close()
        if 'ssh' in locals():
            ssh.close()

@app.route('/api/sftp/<int:host_id>/list')
@handle_error
@auth_required
def sftp_list(host_id):
    """Get the SFTP file list"""
    path = request.args.get('path', '/')
    host = db.get_host(host_id)
    
    try:
        with paramiko.SSHClient() as ssh:
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            ssh.connect(
                host['address'],
                port=host['port'],
                username=host['username'],
                password=host['password']
            )
            
            with ssh.open_sftp() as sftp:
                file_list = []
                for entry in sftp.listdir_attr(path):
                    file_list.append({
                        'name': entry.filename,
                        'type': 'directory' if stat.S_ISDIR(entry.st_mode) else 'file',
                        'size': entry.st_size,
                        'mtime': entry.st_mtime
                    })
                return jsonify(file_list)
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/sftp/<int:host_id>/mkdir', methods=['POST'])
@handle_error
@auth_required
def sftp_mkdir(host_id):
    """Create a folder"""
    host = db.get_host(host_id)
    if not host:
        return jsonify({'error': 'Host not found'}), 404

    try:
        data = request.json
        path = data.get('path')
        if not path:
            return jsonify({'error': 'Path is required'}), 400

        with paramiko.SSHClient() as ssh:
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            ssh.connect(
                host['address'],
                port=host['port'],
                username=host['username'],
                password=host['password']
            )
            
            with ssh.open_sftp() as sftp:
                try:
                    sftp.stat(path)
                    return jsonify({'error': 'Directory already exists'}), 400
                except IOError:
                    sftp.mkdir(path)

        return jsonify({'success': True})
    except Exception as e:
        app.logger.error(f"SFTP mkdir error: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/sftp/<int:host_id>/upload', methods=['POST'])
@handle_error
@auth_required
def sftp_upload(host_id):
    """Process file upload"""
    host = db.get_host(host_id)
    if not host:
        return jsonify({'error': 'Host not found'}), 404

    try:
        path = request.form.get('path', '/')
        if not request.files:
            return jsonify({'error': 'No files provided'}), 400

        files = request.files.getlist('files[]')
        
        with paramiko.SSHClient() as ssh:
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            ssh.connect(
                host['address'],
                port=host['port'],
                username=host['username'],
                password=host['password']
            )
            
            with ssh.open_sftp() as sftp:
                for file in files:
                    if file.filename:
                        filename = secure_filename(file.filename)
                        remote_path = os.path.join(path, filename).replace('\\', '/')
                        
                        temp_path = os.path.join('/tmp', filename)
                        file.save(temp_path)
                        
                        try:
                            sftp.put(temp_path, remote_path)
                        finally:
                            if os.path.exists(temp_path):
                                os.remove(temp_path)

        return jsonify({'success': True})
    except Exception as e:
        app.logger.error(f"SFTP upload error: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/sftp/<int:host_id>/rename', methods=['POST'])
@handle_error
@auth_required
def sftp_rename(host_id):
    """Rename a file or folder"""
    host = db.get_host(host_id)
    if not host:
        return jsonify({'error': 'Host not found'}), 404

    try:
        data = request.json
        old_path = data.get('old_path')
        new_path = data.get('new_path')
        
        if not old_path or not new_path:
            return jsonify({'error': 'Both old_path and new_path are required'}), 400

        with paramiko.SSHClient() as ssh:
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            ssh.connect(
                host['address'],
                port=host['port'],
                username=host['username'],
                password=host['password']
            )
            
            with ssh.open_sftp() as sftp:
                try:
                    sftp.stat(new_path)
                    return jsonify({'error': 'Destination already exists'}), 400
                except IOError:
                    sftp.rename(old_path, new_path)

        return jsonify({'success': True})
    except Exception as e:
        app.logger.error(f"SFTP rename error: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/sftp/<int:host_id>/touch', methods=['POST'])
@handle_error
@auth_required
def sftp_touch(host_id):
    """Create an empty file"""
    host = db.get_host(host_id)
    if not host:
        return jsonify({'error': 'Host not found'}), 404

    try:
        data = request.json
        path = data.get('path')
        
        if not path:
            return jsonify({'error': 'Path is required'}), 400

        with paramiko.SSHClient() as ssh:
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            ssh.connect(
                host['address'],
                port=host['port'],
                username=host['username'],
                password=host['password']
            )
            
            with ssh.open_sftp() as sftp:
                try:
                    sftp.stat(path)
                    return jsonify({'error': 'File already exists'}), 400
                except IOError:
                    with sftp.file(path, 'w') as f:
                        f.write('')

        return jsonify({'success': True})
    except Exception as e:
        app.logger.error(f"SFTP touch error: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/sftp/<int:host_id>/read')
@handle_error
@auth_required
def sftp_read(host_id):
    """Read file content"""
    host = db.get_host(host_id)
    if not host:
        return jsonify({'error': 'Host not found'}), 404

    path = request.args.get('path')

    try:
        with paramiko.SSHClient() as ssh:
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            ssh.connect(
                host['address'],
                port=host['port'],
                username=host['username'],
                password=host['password']
            )
            
            with ssh.open_sftp() as sftp:
                with sftp.file(path, 'r') as f:
                    content = f.read().decode('utf-8', errors='replace')
                return jsonify({'content': content})
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/sftp/<int:host_id>/write', methods=['POST'])
@handle_error
@auth_required
def sftp_write(host_id):
    """Write file contents"""
    host = db.get_host(host_id)
    if not host:
        return jsonify({'error': 'Host not found'}), 404

    try:
        data = request.json
        path = data.get('path')
        content = data.get('content', '')
        
        if not path:
            return jsonify({'error': 'Path is required'}), 400

        with paramiko.SSHClient() as ssh:
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            ssh.connect(
                host['address'],
                port=host['port'],
                username=host['username'],
                password=host['password']
            )
            
            with ssh.open_sftp() as sftp:
                with sftp.file(path, 'w') as f:
                    f.write(content)

        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/sftp/<int:host_id>/delete', methods=['POST'])
@handle_error
@auth_required
def sftp_delete(host_id):
    """Delete a file or folder"""
    host = db.get_host(host_id)
    if not host:
        return jsonify({'error': 'Host not found'}), 404

    try:
        data = request.json
        path = data.get('path')
        is_directory = data.get('is_directory', False)
        
        if not path:
            return jsonify({'error': 'Path is required'}), 400

        with paramiko.SSHClient() as ssh:
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            ssh.connect(
                host['address'],
                port=host['port'],
                username=host['username'],
                password=host['password']
            )
            
            with ssh.open_sftp() as sftp:
                if is_directory:
                    # 检查目录是否为空
                    if sftp.listdir(path):
                        return jsonify({'error': 'Directory is not empty'}), 400
                    sftp.rmdir(path)
                else:
                    sftp.remove(path)

        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/sftp/<int:host_id>/download')
@handle_error
@auth_required
def sftp_download(host_id):
    """Download the file"""
    host = db.get_host(host_id)
    if not host:
        return jsonify({'error': 'Host not found'}), 404

    path = request.args.get('path')
    if not path:
        return jsonify({'error': 'Path is required'}), 400

    try:
        filename = os.path.basename(path)
        with paramiko.SSHClient() as ssh:
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            ssh.connect(
                host['address'],
                port=host['port'],
                username=host['username'],
                password=host['password']
            )
            
            with ssh.open_sftp() as sftp:
                # Check file status
                file_attr = sftp.stat(path)
                if stat.S_ISDIR(file_attr.st_mode):
                    return jsonify({'error': 'Cannot download a directory'}), 400
                
                # To prevent path traversal vulnerabilities, only file names are processed
                temp_path = os.path.join('/tmp', secure_filename(filename))
                sftp.get(path, temp_path)
                
                try:
                    with open(temp_path, 'rb') as f:
                        content = f.read()
                    
                    # Create a response object
                    response = Response(content)
                    response.headers['Content-Type'] = 'application/octet-stream'
                    response.headers['Content-Disposition'] = f'attachment; filename="{filename}"'
                    return response
                finally:
                    if os.path.exists(temp_path):
                        os.remove(temp_path)
    
    except Exception as e:
        app.logger.error(f"SFTP download error: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.errorhandler(404)
def not_found_error(error):
    """Handle 404 error"""
    app.logger.error(f"404 Error: Path={request.path}, IP={request.remote_addr}, Method={request.method}")
    
    # If it is an API or WebSocket request, return a JSON error
    if request.path.startswith('/api/') or request.path.startswith('/ws/'):
        return jsonify({'error': 'Not found'}), 404
    
    # All other paths are handed over to the front-end routing process, which is consistent with the serve_react_app
    return send_from_directory(app.static_folder, 'index.html')

@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors"""
    return jsonify({'error': 'Internal server error'}), 500

@app.route('/api/access-logs', methods=['GET'])
@handle_error
@auth_required
def get_access_logs():
    """Get access log"""
    logs = db.get_access_logs()
    return jsonify(logs)

@app.route('/api/access-logs/cleanup', methods=['POST'])
@handle_error
@auth_required
def cleanup_logs():
    """Clean up old logs"""
    db.cleanup_old_logs()
    return jsonify({'message': 'Logs from 7 days ago have been cleared'})

def create_required_directories():
    """Create the necessary directory"""
    directories = ['logs', 'data']
    for directory in directories:
        os.makedirs(directory, exist_ok=True)

@app.route('/api/upload', methods=['POST'])
@handle_error
@auth_required
def api_upload():
    """The file upload processing of the API version is adapted to the format sent by the front-end, and supports some successful scenarios"""
    if 'file' not in request.files:
        return jsonify({'error': 'No files have been uploaded'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        remote_path = request.form.get('remote_path', '/tmp/')
        hosts_json = request.form.get('hosts', 'all')
        
        # Save the file
        file_path = os.path.join(UPLOAD_FOLDER, filename)
        file.save(file_path)
        
        try:
            #Determine the upload type and target host
            remote_file_path = os.path.join(remote_path, filename).replace('\\', '/')
            
            if hosts_json != 'all':
                try:
                    hosts = json.loads(hosts_json)
                    if not hosts:
                        return jsonify({'error': 'Host not selected'}), 400
                except json.JSONDecodeError:
                    return jsonify({'error': 'Invalid host list format'}), 400
                
                # Find the selected host information and prepare for subsequent recording results
                host_ids = [str(h) for h in hosts]
                all_hosts = db.get_hosts()
                host_map = {str(h['id']): h for h in all_hosts}
                
                #Call ansible to execute file upload
                result = ansible.copy_file_to_hosts(file_path, remote_file_path, hosts)
            else:
                #Get all host information and prepare for subsequent recording results
                all_hosts = db.get_hosts()
                host_map = {str(h['id']): h for h in all_hosts}
                host_ids = list(host_map.keys())
                
                #Upload to all hosts
                result = ansible.copy_file_to_all(file_path, remote_file_path)
            
            # Delete temporary files
            if os.path.exists(file_path):
                os.remove(file_path)
            
            # Processing results, distinguishing between complete success, partial success and complete failure
            successful_hosts = []
            failed_hosts = {}
            
            # Processing the host successfully
            for host, res in result.get('success', {}).items():
                # Find the corresponding host ID from host_map
                host_id = next((id for id, h in host_map.items() if h['address'] == host), None)
                if host_id:
                    successful_hosts.append(host_id)
            
            # Handling failed and unreachable hosts
            for host, res in result.get('failed', {}).items():
                host_id = next((id for id, h in host_map.items() if h['address'] == host), None)
                if host_id:
                    failed_hosts[host_id] = res.get('msg', 'Unknown Error')
            
            for host, res in result.get('unreachable', {}).items():
                host_id = next((id for id, h in host_map.items() if h['address'] == host), None)
                if host_id:
                    failed_hosts[host_id] = 'The host is unreachable'
            
            # Calculate success rate and overall status
            total = len(host_ids)
            succeeded = len(successful_hosts)
            
            # Determine the response status
            if succeeded == total:  # All succeeded
                return jsonify({
                    'success': True,
                    'message': 'File upload successfully',
                    'details': {
                        'succeeded': successful_hosts,
                        'failed': {}
                    }
                })
            elif succeeded > 0:  # Partially successful
                return jsonify({
                    'success': True,
                    'message': f'File part upload successfully ({succeeded}/{total})',
                    'details': {
                        'succeeded': successful_hosts,
                        'failed': failed_hosts
                    }
                }), 207  # 207 Multi-Status
            else:  # All failed
                return jsonify({
                    'success': False,
                    'message': 'File upload failed',
                    'details': {
                        'succeeded': [],
                        'failed': failed_hosts
                    }
                }), 500
                
        except Exception as e:
            app.logger.error(f"File upload failed: {str(e)}")
            # Make sure to delete temporary files when errors occur
            if os.path.exists(file_path):
                os.remove(file_path)
            return jsonify({
                'success': False,
                'message': str(e),
                'details': {
                    'succeeded': [],
                    'failed': {'all': str(e)}
                }
            }), 500
    
    return jsonify({'error': 'Unsupported file types'}), 400

# New JWT related functions
def generate_token(user_id):
    """Generate JWT token"""
    payload = {
        'user_id': user_id,
        'exp': datetime.datetime.utcnow() + datetime.timedelta(seconds=JWT_EXPIRATION),
        'iat': datetime.datetime.utcnow()
    }
    return jwt.encode(payload, JWT_SECRET, algorithm='HS256')

def decode_token(token):
    """Decode and verify JWT tokens"""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=['HS256'])
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None

# Add a function for WebSocket token generation
def generate_ws_token(host_id):
    """Generate tokens for WebSocket connections"""
    # Get the Authorization header
    auth_header = request.headers.get('Authorization')
    jwt_token = None
    
    # Extract token from header
    if auth_header and auth_header.startswith('Bearer '):
        jwt_token = auth_header.split(' ')[1]
    
    #If the token is not in the header, try to get it from cookies
    if not jwt_token:
        jwt_token = request.cookies.get('token')
        
    # Verify JWT token
    if not jwt_token or not decode_token(jwt_token):
        return None
    
    timestamp = int(time.time())
    message = f"{host_id}:{timestamp}"
    
    # Generate HMAC signature using app.secret_key as key
    signature = hmac.new(
        app.secret_key.encode(),
        message.encode(),
        hashlib.sha256
    ).hexdigest()
    
    # Return format: host_id:timestamp:signature
    return f"{host_id}:{timestamp}:{signature}"

# Add API endpoint to get WebSocket token
@app.route('/api/ws-token/<int:host_id>', methods=['GET'])
@auth_required
def get_ws_token(host_id):
    """Get WebSocket Connection Token"""
    host = db.get_host(host_id)
    if not host:
        return jsonify({'error': 'Host not found'}), 404
        
    token = generate_ws_token(host_id)
    if not token:
        return jsonify({'error': 'Unauthorized'}), 401
        
    return jsonify({'token': token})

@app.route('/api/playbook/execute', methods=['POST'])
@handle_error
@auth_required
def execute_playbook():
    """Perform a user-defined Ansible Playbook"""
    data = request.json
    playbook_content = data.get('playbook')
    host_ids = data.get('host_ids', [])
    
    #Verify input
    if not playbook_content:
        return jsonify({'error': 'Playbook content not provided'}), 400
    
    #If a host ID is specified, information about these hosts is obtained
    target_hosts = None
    if host_ids:
        target_hosts = [db.get_host(host_id) for host_id in host_ids]
        # Filter out non-existent hosts
        target_hosts = [host for host in target_hosts if host]
    
    # Execute the Playbook
    try:
        result = ansible.execute_custom_playbook(playbook_content, target_hosts)
        
        # Record execution log
# If there is a specified host, a log will be recorded for each host.
        if target_hosts:
            for host in target_hosts:
                host_status = 'success'
                if host['address'] in result['summary']['failed']:
                    host_status = 'failed'
                elif host['address'] in result['summary']['unreachable']:
                    host_status = 'unreachable'
                
                db.log_command(
                    host['id'],
                    'Custom Playbook Execution',
                    json.dumps({'playbook_logs': result['logs']}),
                    host_status
                )
        else:
            #If no host is specified, a common log is logged
            db.log_command(
                None,
                'Custom Playbook Execution',
                json.dumps({'playbook_logs': result['logs']}),
                'success' if result['success'] else 'failed'
            )
        
        return jsonify(result)
    except Exception as e:
        app.logger.error(f"Playbook执行错误: {str(e)}")
        return jsonify({'error': f'Playbook execution failed: {str(e)}'}), 500

if __name__ == '__main__':
    create_required_directories()

    logging.basicConfig(
        filename='logs/app.log',
        level=logging.INFO,
        format='%(asctime)s %(levelname)s: %(message)s [in %(pathname)s:%(lineno)d]'
    )
    
    app.run(host='0.0.0.0', port=5000)

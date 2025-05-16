import os
import ansible.constants as C
from ansible.parsing.dataloader import DataLoader
from ansible.inventory.manager import InventoryManager
from ansible.vars.manager import VariableManager
from ansible.playbook.play import Play
from ansible.executor.task_queue_manager import TaskQueueManager
from ansible.plugins.callback import CallbackBase
from ansible import context
from ansible.module_utils.common.collections import ImmutableDict
import tempfile
import json
import subprocess
import threading
import re
from crypto_utils import CryptoUtils

class ResultCallback(CallbackBase):
    """Custom callback classes to handle task results"""
    def __init__(self):
        super().__init__()
        self.host_ok = {}
        self.host_unreachable = {}
        self.host_failed = {}

    def v2_runner_on_ok(self, result):
        self.host_ok[result._host.get_name()] = result

    def v2_runner_on_failed(self, result, ignore_errors=False):
        self.host_failed[result._host.get_name()] = result

    def v2_runner_on_unreachable(self, result):
        self.host_unreachable[result._host.get_name()] = result

class AnsibleManager:
    def __init__(self, db):
        self.db = db
        self.crypto = CryptoUtils()
        context.CLIARGS = ImmutableDict(
            connection='smart',
            module_path=None,
            forks=30,
            become=None,
            become_method=None,
            become_user=None,
            check=False,
            diff=False,
            verbosity=0
        )

    def generate_inventory(self, hosts):
        """Generate temporary inventory files"""
        inventory_content = ["[managed_hosts]"]
        for host in hosts:
            # Make sure to use the decrypted password
            password = host.get('password')
            # If the password is encrypted, decrypt it
            if isinstance(password, str) and password.startswith("ENC:"):
                password = self.crypto.decrypt(password)
                
            line = f"{host['address']} ansible_user={host['username']} "
            line += f"ansible_port={host['port']} ansible_ssh_pass={password} "
            line += "ansible_ssh_common_args='-o StrictHostKeyChecking=no'"
            inventory_content.append(line)

        # Create a temporary file
        fd, inventory_path = tempfile.mkstemp(prefix='ansible_inventory_')
        with os.fdopen(fd, 'w') as f:
            f.write('\n'.join(inventory_content))
        
        return inventory_path

    def execute_command(self, command, target_hosts=None):
        """Execute the Ansible command"""
        if target_hosts is None:
            target_hosts = self.db.get_hosts()

        # Generate temporary inventory files
        inventory_path = self.generate_inventory(target_hosts)
        
        try:
            # Initialize the necessary objects
            loader = DataLoader()
            inventory = InventoryManager(loader=loader, sources=inventory_path)
            variable_manager = VariableManager(loader=loader, inventory=inventory)
            
            # Create play source data
            play_source = dict(
                name="Ansible Ad-Hoc",
                hosts='managed_hosts',
                gather_facts='no',
                tasks=[dict(action=dict(module='shell', args=command))]
            )

            # Create a play object
            play = Play().load(play_source, variable_manager=variable_manager, loader=loader)

            # Create a callback plugin object
            results_callback = ResultCallback()

            # Create a Task Queue Manager
            tqm = None
            try:
                tqm = TaskQueueManager(
                    inventory=inventory,
                    variable_manager=variable_manager,
                    loader=loader,
                    passwords=dict(),
                    stdout_callback=results_callback
                )
                # Execute play
                tqm.run(play)
            finally:
                if tqm is not None:
                    tqm.cleanup()

            # Processing results
            results = {
                'success': {},
                'failed': {},
                'unreachable': {}
            }

            # Successful processing results
            for host, result in results_callback.host_ok.items():
                results['success'][host] = {
                    'stdout': result._result.get('stdout', ''),
                    'stderr': result._result.get('stderr', ''),
                    'rc': result._result.get('rc', 0)
                }
                #Logging
                host_id = next((h['id'] for h in target_hosts if h['address'] == host), None)
                if host_id:
                    self.db.log_command(
                        host_id,
                        command,
                        json.dumps(results['success'][host]),
                        'success'
                    )

            # The result of the failure
            for host, result in results_callback.host_failed.items():
                results['failed'][host] = {
                    'msg': result._result.get('msg', ''),
                    'rc': result._result.get('rc', 1)
                }
                host_id = next((h['id'] for h in target_hosts if h['address'] == host), None)
                if host_id:
                    self.db.log_command(
                        host_id,
                        command,
                        json.dumps(results['failed'][host]),
                        'failed'
                    )

            # Handle unreachable results
            for host, result in results_callback.host_unreachable.items():
                results['unreachable'][host] = {
                    'msg': result._result.get('msg', '')
                }
                host_id = next((h['id'] for h in target_hosts if h['address'] == host), None)
                if host_id:
                    self.db.log_command(
                        host_id,
                        command,
                        json.dumps(results['unreachable'][host]),
                        'unreachable'
                    )

            return results

        finally:
            # Clean up temporary files
            os.remove(inventory_path)

    def execute_ping(self, target_hosts):
        """Execute the Ansible ping module"""
        # Generate temporary inventory files
        inventory_path = self.generate_inventory(target_hosts)
        
        try:
            #Initialize the necessary objects
            loader = DataLoader()
            inventory = InventoryManager(loader=loader, sources=inventory_path)
            variable_manager = VariableManager(loader=loader, inventory=inventory)
            
            # Create play source data
            play_source = dict(
                name="Ansible Ping",
                hosts='managed_hosts',
                gather_facts='no',
                tasks=[dict(action=dict(module='ping'))]
            )

            #Create a play object
            play = Play().load(play_source, variable_manager=variable_manager, loader=loader)

            # Create a callback plugin object
            results_callback = ResultCallback()

            # Create a Task Queue Manager
            tqm = None
            try:
                tqm = TaskQueueManager(
                    inventory=inventory,
                    variable_manager=variable_manager,
                    loader=loader,
                    passwords=dict(),
                    stdout_callback=results_callback
                )
                #Execute play
                tqm.run(play)
            finally:
                if tqm is not None:
                    tqm.cleanup()

            # Processing results
            results = {
                'success': {},
                'failed': {},
                'unreachable': {}
            }

            # Successful processing results
            for host, result in results_callback.host_ok.items():
                results['success'][host] = result._result
                # Logging
                host_id = next((h['id'] for h in target_hosts if h['address'] == host), None)
                if host_id:
                    self.db.log_command(
                        host_id,
                        'ping',
                        json.dumps(result._result),
                        'success'
                    )

            # The result of the failure
            for host, result in results_callback.host_failed.items():
                results['failed'][host] = result._result
                host_id = next((h['id'] for h in target_hosts if h['address'] == host), None)
                if host_id:
                    self.db.log_command(
                        host_id,
                        'ping',
                        json.dumps(result._result),
                        'failed'
                    )

            # Handle unreachable results
            for host, result in results_callback.host_unreachable.items():
                results['unreachable'][host] = result._result
                host_id = next((h['id'] for h in target_hosts if h['address'] == host), None)
                if host_id:
                    self.db.log_command(
                        host_id,
                        'ping',
                        json.dumps(result._result),
                        'unreachable'
                    )

            return results

        finally:
            # Clean up temporary files
            os.remove(inventory_path)

    def get_host_facts(self, host_id):
        """Get host details"""
        host = self.db.get_host(host_id)
        if not host:
            return None

        # Execute the setup module to obtain host information
        results = self.execute_command('ansible_facts', [host])
        if host['address'] in results['success']:
            return results['success'][host['address']]
        return None

    def run_playbook(self, play):
        """Run the playbook"""
        try:
            # Initialize the necessary objects
            loader = DataLoader()
            inventory = InventoryManager(loader=loader, sources=self.generate_inventory(self.db.get_hosts()))
            variable_manager = VariableManager(loader=loader, inventory=inventory)
            
            #Create a callback plugin object
            results_callback = ResultCallback()

            # Create a Task Queue Manager
            tqm = None
            try:
                tqm = TaskQueueManager(
                    inventory=inventory,
                    variable_manager=variable_manager,
                    loader=loader,
                    passwords=dict(),
                    stdout_callback=results_callback
                )
                # Execute play
                for play_item in play:
                    play_obj = Play().load(play_item, variable_manager=variable_manager, loader=loader)
                    tqm.run(play_obj)
            finally:
                if tqm is not None:
                    tqm.cleanup()

            return {
                'success': results_callback.host_ok,
                'failed': results_callback.host_failed,
                'unreachable': results_callback.host_unreachable
            }
        except Exception as e:
            raise Exception(f"Failed to execute the playbook: {str(e)}")

    def copy_file_to_hosts(self, src, dest, hosts):
        """Copy the file to the specified host and return detailed success/failure results"""
        if not isinstance(hosts, list):
            hosts = [hosts]
        
        # Get the address list of selected hosts
        selected_hosts = []
        all_hosts = self.db.get_hosts()
        for host in all_hosts:
            # Compatible with string ID and numeric ID, convert to string for comparison
            host_id_str = str(host['id'])
            if host_id_str in [str(h) for h in hosts]:
                selected_hosts.append(host['address'])
        
        if not selected_hosts:
            raise Exception("No selected host was found")
        
        # Create a host group using the address list of selected hosts
        hosts_str = ','.join(selected_hosts)
        
        play = [{
            'name': 'Copy file to selected hosts',
            'hosts': hosts_str,
            'gather_facts': 'no',
            'tasks': [{
                'name': 'Ensure destination directory exists',
                'file': {
                    'path': os.path.dirname(dest),
                    'state': 'directory',
                    'mode': '0755'
                }
            }, {
                'name': 'Copy file to remote hosts',
                'copy': {
                    'src': src,
                    'dest': dest,
                    'mode': '0644'
                }
            }]
        }]
        
        try:
            # Execute and get the results
            result = self.run_playbook(play)
            return result
        except Exception as e:
            raise Exception(f"Failed to copy the file: {str(e)}")

    def copy_file_to_all(self, src, dest):
        """Copy the file to all hosts and return detailed success/failure results"""
        play = [{
            'name': 'Copy file to all hosts',
            'hosts': 'all',
            'gather_facts': 'no',
            'tasks': [{
                'name': 'Ensure destination directory exists',
                'file': {
                    'path': os.path.dirname(dest),
                    'state': 'directory',
                    'mode': '0755'
                }
            }, {
                'name': 'Copy file to remote hosts',
                'copy': {
                    'src': src,
                    'dest': dest,
                    'mode': '0644'
                }
            }]
        }]
        
        try:
            # Execute and get the results
            result = self.run_playbook(play)
            return result
        except Exception as e:
            raise Exception(f"Failed to copy the file: {str(e)}")

    def execute_custom_playbook(self, playbook_content, target_hosts=None):
        """Perform a custom playbook"""
        # Create a temporary playbook file
        fd, playbook_path = tempfile.mkstemp(prefix='ansible_playbook_', suffix='.yml')
        with os.fdopen(fd, 'w') as f:
            f.write(playbook_content)
        
        try:
            # Create a temporary output file
            output_file = tempfile.mktemp(prefix='ansible_output_')
            
            # If a specific host is provided, a temporary inventory is generated
            inventory_option = []
            if target_hosts:
                inventory_path = self.generate_inventory(target_hosts)
                inventory_option = ['-i', inventory_path]
            
            # Build ansible-playbook command
            cmd = ['ansible-playbook', playbook_path] + inventory_option + ['-v']
            
            # Create log processing functions and callbacks
            logs = []
            log_lock = threading.Lock()
            
            def process_output(process):
                for line in iter(process.stdout.readline, b''):
                    decoded_line = line.decode('utf-8').rstrip()
                    with log_lock:
                        logs.append(decoded_line)
            
            # Execute commands to capture output in real time
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                universal_newlines=False
            )
            
            # Start thread processing output
            output_thread = threading.Thread(target=process_output, args=(process,))
            output_thread.daemon = True
            output_thread.start()
            
            # Wait for the command execution to complete
            process.wait()
            output_thread.join()
            
            # Analysis results
            result = {
                'success': process.returncode == 0,
                'return_code': process.returncode,
                'logs': logs,
                'summary': self._parse_playbook_result(logs)
            }
            
            return result
        
        finally:
            # Clean up temporary files
            os.remove(playbook_path)
            if target_hosts:
                os.remove(inventory_path)
    
    def _parse_playbook_result(self, logs):
        """Analyze the Playbook execution results and generate host success/failure statistics"""
        summary = {
            'success': [],
            'failed': [],
            'unreachable': []
        }
        
        #Regular expression matching successful, failed, and unreachable hosts
        success_pattern = re.compile(r'([\w\.-]+)\s+:\s+ok=\d+')
        failed_pattern = re.compile(r'([\w\.-]+)\s+:\s+.*failed=([1-9]\d*)')
        unreachable_pattern = re.compile(r'([\w\.-]+)\s+:\s+.*unreachable=([1-9]\d*)')
        
        for line in logs:
            # Check the successful host
            success_match = success_pattern.search(line)
            if success_match and not failed_pattern.search(line) and not unreachable_pattern.search(line):
                host = success_match.group(1)
                if host not in summary['success']:
                    summary['success'].append(host)
            
            # Check the failed host
            failed_match = failed_pattern.search(line)
            if failed_match:
                host = failed_match.group(1)
                if host not in summary['failed']:
                    summary['failed'].append(host)
            
            # Check for unreachable hosts
            unreachable_match = unreachable_pattern.search(line)
            if unreachable_match:
                host = unreachable_match.group(1)
                if host not in summary['unreachable']:
                    summary['unreachable'].append(host)
        
        return summary

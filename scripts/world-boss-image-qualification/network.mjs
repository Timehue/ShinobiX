import assert from 'node:assert/strict';
import {BlockList,isIP} from 'node:net';

const privateAddresses=new BlockList();
privateAddresses.addSubnet('10.0.0.0',8);privateAddresses.addSubnet('172.16.0.0',12);privateAddresses.addSubnet('192.168.0.0',16);

// Linux Docker hosts can reach an internal bridge directly without publishing ports.
export function internalContainerBase(inspect,network){
 assert.equal(inspect.State?.Running,true,'Qualification container is not running');
 assert.deepEqual(Object.keys(inspect.NetworkSettings?.Networks??{}),[network],'Only the disposable internal network is allowed');
 assert.ok(Object.values(inspect.HostConfig?.PortBindings??{}).every(binding=>binding===null),'Host port requests are forbidden');
 assert.ok(Object.values(inspect.NetworkSettings?.Ports??{}).every(binding=>binding===null),'Published ports are forbidden');
 const address=inspect.NetworkSettings.Networks[network].IPAddress;
 assert.ok(isIP(address??'')===4&&privateAddresses.check(address),'Expected a private IPv4 address on the disposable network');
 return 'http://'+address+':3000';
}

import { fireEvent, render, screen } from '@testing-library/react';
import ServiceConnectionNotice from './ServiceConnectionNotice';
import { warmService } from '../api';
let mockConnectionState='unavailable';
jest.mock('../api',()=>({warmService:jest.fn()}));
jest.mock('../serviceActivity',()=>({startServiceActivity:()=>()=>{}}));
jest.mock('../serviceRecovery',()=>({watchServiceConnection:listener=>{listener(mockConnectionState);return()=>{};}}));
beforeEach(()=>{mockConnectionState='unavailable';warmService.mockReset().mockResolvedValue();});
test('unavailable connection offers explicit reconnect without reloading the page',()=>{
 render(<ServiceConnectionNotice />);fireEvent.click(screen.getByRole('button',{name:'Reconnect'}));
 expect(warmService).toHaveBeenCalledTimes(1);expect(screen.getByText(/check whether any submitted change was saved/i)).toBeInTheDocument();
});
test('warming state explains the bounded wait and does not offer duplicate reconnect',()=>{
 mockConnectionState='connecting';render(<ServiceConnectionNotice />);
 expect(screen.getByRole('status')).toHaveTextContent('up to two minutes');expect(screen.queryByRole('button',{name:'Reconnect'})).not.toBeInTheDocument();
});

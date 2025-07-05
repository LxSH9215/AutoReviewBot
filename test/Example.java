// EmployeeService.java
import java.util.*;

public class EmployeeService {
    // Violation: Exposed mutable collection (PROTECT_MUTABLE_STATE)
    public Map<Integer, Employee> employeeCache = new HashMap<>();
    
    // Violation: Returning null (AVOID_NULL_RETURN)
    public Employee findEmployeeById(int id) {
        if (!employeeCache.containsKey(id)) {
            return null;
        }
        return employeeCache.get(id);
    }

    // Violation: Using concrete implementation (CODE_TO_INTERFACES)
    public ArrayList<String> getActiveEmployeeNames() {
        ArrayList<String> names = new ArrayList<>();
        for (Employee emp : employeeCache.values()) {
            if (emp.isActive()) {
                names.add(emp.getName());
            }
        }
        return names;
    }

    // Violation: Obsolete collection (OBSOLETE_COLLECTION)
    public void processInactiveEmployees() {
        Vector<Employee> inactiveList = new Vector<>();
        for (Employee emp : employeeCache.values()) {
            if (!emp.isActive()) {
                inactiveList.add(emp);
            }
        }
        
        try {
            // Violation: Generic exception (GENERIC_EXCEPTION)
            inactiveList.forEach(this::archiveEmployee);
        } catch (Exception e) {
            // Violation: Empty catch block (AVOID_EMPTY_CATCH)
        }
    }
    
    private void archiveEmployee(Employee emp) {
        // Implementation omitted
    }
    
    // Violation: Not using streams (USE_STREAMS)
    public List<Employee> getHighlyPaidEmployees(double threshold) {
        List<Employee> result = new LinkedList<>();
        for (Employee emp : employeeCache.values()) {
            if (emp.getSalary() > threshold) {
                result.add(emp);
            }
        }
        return result;
    }
    
    // Violation: Unsafe Optional access (UNSAFE_OPTIONAL_ACCESS)
    public void printManagerDetails(int id) {
        findOptionalEmployeeById(id).get().getManager().toString();
    }
    
    public Optional<Employee> findOptionalEmployeeById(int id) {
        return Optional.ofNullable(employeeCache.get(id));
    }
}

class Employee {
    private int id;
    private String name;
    private double salary;
    private boolean active;
    private Employee manager;
    
    // Violation: Missing equals/hashCode (MISSING_HASHCODE)
    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Employee)) return false;
        Employee employee = (Employee) o;
        return id == employee.id;
    }
    
    // Getters and setters
    public String getName() { return name; }
    public double getSalary() { return salary; }
    public boolean isActive() { return active; }
    public Employee getManager() { return manager; }
}

// Violation: Unnecessary interface (not in rules.yaml but good example)
interface EmployeeRepository {
    List<Employee> getAllEmployees();
    void saveEmployee(Employee e);
}

class DatabaseEmployeeRepository implements EmployeeRepository {
    // Implementation would go here
}
